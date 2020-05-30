/*jslint node:true nomen:true*/
'use strict';
const net = require('net'),
    dgram = require('dgram'),
    util = require('util'),
    async = require('async'),
    events = require('events'),
    //iconv = require('iconv-lite'),
    eiscp_commands = require('./eiscp-commands.json'),
    COMMANDS = eiscp_commands.commands,
    COMMAND_MAPPINGS = eiscp_commands.command_mappings,
    VALUE_MAPPINGS = eiscp_commands.value_mappings,
    MODELSETS = eiscp_commands.modelsets,
    config = {port: 60128, reconnect: true, reconnect_sleep: 5, modelsets: [], send_delay: 500};
let self, eiscp, send_queue;

module.exports = self = new events.EventEmitter();
self.is_connected = false;

function eiscp_packet(data){
    /*
      Wraps command or iscp message in eISCP packet for communicating over Ethernet
      type is device type where 1 is receiver and x is for the discovery broadcast
      Returns complete eISCP packet as a buffer ready to be sent
    */
    // Add ISCP header if not already present
    if (data[0] !== '!') data = '!1' + data;
    // ISCP message
    const iscp_msg = new Buffer(data + '\x0D\x0a');
    // eISCP header
    const header = new Buffer([
        73, 83, 67, 80, // magic
        0, 0, 0, 16,    // header size
        0, 0, 0, 0,     // data size
        1,              // version
        0, 0, 0         // reserved
    ]);
    // write data size to eISCP header
    header.writeUInt32BE(iscp_msg.length, 8);
    return Buffer.concat([header, iscp_msg]);
}

function iscp_to_command(iscp_message){
    /*  Transform a low-level ISCP message to a high-level command  */
    let command, value;
    const result = [];
    if (iscp_message.includes('ISCP')){
        const arrMessage = iscp_message.split('\r\n');
        arrMessage.forEach((val, index) => {
            if (val){
                val = val.slice(18).replace(/\r|\n/g, '').replace(/\u001a+/g, '');
                //console.log('val = ' + JSON.stringify(val));
                command = val.slice(0, 3);
                value = val.slice(3);
                if (command === 'NJA'){
                    //console.log();
                }
                Object.keys(COMMANDS).forEach((zone) => {
                    if (typeof COMMANDS[zone][command] !== 'undefined'){
                        result[index] = {};
                        const zone_cmd = COMMANDS[zone][command];
                        result[index].iscp_command = command;
                        result[index].command = zone_cmd.name;
                        result[index].zone = zone;
                        if (typeof zone_cmd.values[value] !== 'undefined' && in_modelsets(VALUE_MAPPINGS[zone][command][zone_cmd.values[value].name].models)){
                            result[index].argument = zone_cmd.values[value].name;
                        } else {
                            const supported = [];
                            if (typeof VALUE_MAPPINGS[zone][command].INTRANGES !== 'undefined' && /^[-+0-9a-fA-F]+$/.test(value)){
                                value = parseInt(value, 16);
                            }
                            Object.keys(VALUE_MAPPINGS[zone][command]).forEach((key) => {
                                if (in_modelsets(VALUE_MAPPINGS[zone][command][key].models)){
                                    supported.push(key);
                                }
                            });
                            if (supported.length > 0){
                                result[index].argument = value;
                            } else {
                                result.splice(index, 1);
                                index--;
                            }
                        }
                        index++;
                    }
                });
            }
        });
    }
    return result;
}

function command_to_iscp(zone, command, value){
    /* Transform high-level command to a low-level ISCP message  */
    // Find the command in our database, resolve to internal eISCP command
    if (typeof COMMANDS[zone] === 'undefined'){
        self.emit('error', util.format('ERROR (zone_not_exist) Zone %s does not exist in command file', zone));
        return;
    }
    if (typeof COMMAND_MAPPINGS[zone][command] === 'undefined'){
        self.emit('error', util.format('ERROR (cmd_not_exist) Command %s does not exist in zone %s', command, zone));
        return;
    }
    const prefix = COMMAND_MAPPINGS[zone][command];
    if (typeof VALUE_MAPPINGS[zone][prefix][value] === 'undefined'){
        if (typeof VALUE_MAPPINGS[zone][prefix].INTRANGES !== 'undefined' && value !== 'query'){
            if (~value.toString().indexOf('+')){ // For range -12 to + 12
                // Convert decimal number to hexadecimal since receiver doesn't understand decimal
                value = (+value).toString(16).toUpperCase();
                value = '+' + value;
            } else {
                // Convert decimal number to hexadecimal since receiver doesn't understand decimal
                value = (+value).toString(16).toUpperCase();
                // Pad value if it is not 2 digits
                value = (value.length < 2) ? '0' + value :value;
            }
        } else if (!value){
            // Not yet supported command
            self.emit('error', util.format('ERROR (arg_not_exist) Argument %s does not exist in command %s', value, command));
            return;
        } else if (value === 'query'){
            return;
            //value = value;
        }
    } else {
        // Check if the commands modelset is in the receviers modelsets
        if (in_modelsets(VALUE_MAPPINGS[zone][prefix][value].models)){
            value = VALUE_MAPPINGS[zone][prefix][value].value;
        } else {
            self.emit('error', util.format('ERROR (cmd_not_supported) Command %s in zone %s is not supported on this model.', command, zone));
            return;
        }
    }
    self.emit('debug', util.format('DEBUG (command_to_iscp) raw command "%s"', prefix + value));
    return prefix + value;
}

self.connect = function (options){
    /*
      No options required if you only have one receiver on your network. We will find it and connect to it!
      options.host            - Hostname/IP
      options.port            - Port (default: 60128)
      options.send_delay      - Delay in milliseconds between each command sent to receiver (default: 500)
      options.model           - Should be discovered automatically but if you want to override it you can
      options.reconnect       - Try to reconnect if connection is lost (default: false)
      options.reconnect_sleep - Time in seconds to sleep between reconnection attempts (default: 5)
    */
    const connection_properties = {};
    options = options || {};
    config.host = options.host || config.host;
    config.port = options.port || config.port;
    config.model = options.model || config.model;
    config.reconnect = (options.reconnect === undefined) ? config.reconnect :options.reconnect;
    config.reconnect_sleep = options.reconnect_sleep || config.reconnect_sleep;
    connection_properties.host = config.host;
    connection_properties.port = config.port;
    // If no host is configured - we connect to the first device to answer
    if (typeof config.host === 'undefined' || config.host === ''){
        self.discover((err, hosts) => {
            if (!err && hosts && hosts.length > 0){
                self.connect(hosts[0]);
            }
        });
        return;
    }
    // If host is configured but no model is set - we send a discover directly to this receiver
    if (typeof config.model === 'undefined' || config.model === ''){
        self.discover({address: config.host}, (err, hosts) => {
            if (!err && hosts && hosts.length > 0){
                self.connect(hosts[0]);
            }
        });
        return;
    }
    /*
	  Compute modelsets for this model (so commands which are possible on this model are allowed)
      Note that this is not an exact match, model only has to be part of the modelname
    */
    Object.keys(MODELSETS).forEach((set) => {
        MODELSETS[set].forEach((models) => {
            if (models === config.model){
                config.modelsets.push(set);
            }
        });
    });
    self.emit('debug', util.format('INFO (connecting) Connecting to %s:%s (model: %s)', config.host, config.port, config.model));
    // Reconnect if we have previously connected
    if (typeof eiscp !== 'undefined'){
        eiscp.connect(connection_properties);
        return;
    }

    let buffer = '', time;
    // Connecting the first time
    eiscp = net.connect(connection_properties);
    eiscp.on('connect', () => {
        self.is_connected = true;
        self.emit('debug', util.format('INFO (connected) Connected to %s:%s (model: %s)', config.host, config.port, config.model));
        self.emit('connect', config.host, config.port, config.model);
    }).on('close', () => {
        self.is_connected = false;
        self.emit('debug', util.format('INFO (disconnected) Disconnected from %s:%s', config.host, config.port));
        self.emit('close', config.host, config.port);
        if (config.reconnect){
            setTimeout(self.connect, config.reconnect_sleep * 1000);
        }
    }).on('error', (err) => {
        self.emit('error', util.format('ERROR (server_error) Server error on %s:%s - %s', config.host, config.port, err));
        eiscp.destroy();
    }).on('data', (data) => {
        buffer += data.toString('utf8');
        //buffer += data.toString('ascii');
        time && clearTimeout(time);
        //console.log(JSON.stringify(data));
        time = setTimeout(() => {
            self.emit('debug', util.format('DEBUG (iscp_message) - %s', buffer));
            const result = iscp_to_command(buffer);
            buffer = '';
            if (result && result.length > 0 && Object.keys(result[0]).length > 0){
                result.forEach((res) => {
                    res.host = config.host;
                    res.port = config.port;
                    res.model = config.model;
                    self.emit('debug', util.format('DEBUG (received_data) Received data from %s:%s - %j', config.host, config.port, res));
                    self.emit('data', res);
                    // If the command is supported we emit it as well
                    if (typeof res.command !== 'undefined'){
                        if (Array.isArray(res.command)){
                            res.command.forEach((cmd) => {
                                self.emit(cmd, res.argument);
                            });
                        } else {
                            self.emit(res.command, res.argument);
                        }
                    }
                });
            } else {
                //self.emit('debug', util.format("(cmd_not_supported) Command %s.", iscp_message));
            }
        }, 100);
    });
};

self.close = self.disconnect = function (){
    if (self.is_connected){
        eiscp.destroy();
    }
};

send_queue = async.queue((data, callback) => {
    /*
      Syncronous queue which sends commands to device
	  callback(bool error, string error_message)
    */
    if (self.is_connected){
        self.emit('debug', util.format('DEBUG (sent_command) Sent command to %s:%s - %s', config.host, config.port, data));
        //console.log('DEBUG (sent_command) = ' + data);
        eiscp.write(eiscp_packet(data));
        setTimeout(callback, config.send_delay, false);
        return;
    }
    self.emit('error', util.format('ERROR (send_not_connected) Not connected, can\'t send data: %j', data));
    callback('Send command, while not connected', null);
}, 1);

self.raw = function (data, callback){
    /*
      Send a low level command like PWR01
      callback only tells you that the command was sent but not that it succsessfully did what you asked
    */
    if (typeof data !== 'undefined' && data !== ''){
        send_queue.push(data, (err) => {
            if (typeof callback === 'function'){
                callback(err, null);
            }
        });

    } else if (typeof callback === 'function'){
        callback(true, 'No data provided.');
    }
};

self.command = function (zone, cmd, val, callback){
    /*
      Send a high level command like system-power=query
      callback only tells you that the command was sent but not that it succsessfully did what you asked
    */
    self.raw(command_to_iscp(zone, cmd, val,), callback);
};

self.get_commands = function (zone, callback){
    /* Returns all commands in given zone */
    const result = [];
    async.each(Object.keys(COMMAND_MAPPINGS[zone]), (cmd, cb) => {
        const shortNameCmd = COMMAND_MAPPINGS[zone][cmd];
        /*if(shortNameCmd === 'NPZ'){
            console.log();
        }*/
        config.modelsets.forEach((model) => {
            Object.keys(VALUE_MAPPINGS[zone][shortNameCmd]).forEach((value) => {
                if (value === 'INTRANGES'){
                    VALUE_MAPPINGS[zone][shortNameCmd][value].forEach((key) => {
                        if (key.models === model && !result.includes(cmd)){
                            result.push(cmd);
                        }
                    });
                } else {
                    if (VALUE_MAPPINGS[zone][shortNameCmd][value].models === model && !result.includes(cmd)){
                        result.push(cmd);
                    }
                }
            });
        });
        cb();
    }, (err) => {
        callback(err, result);
    });
};

self.get_command = function (zone, command, callback){
    /*  Returns all command values in given zone and command  */
    const result = {}, values = {};
    let descVal;
    if (typeof command === 'function'){
        callback = command;
        command = zone;
        zone = 'main';
    }
    const cmd = COMMAND_MAPPINGS[zone][command];
    const desc = COMMANDS[zone][cmd].description;
    async.each(Object.keys(VALUE_MAPPINGS[zone][cmd]), (val, cb) => {
        if (val !== 'query' && in_modelsets(VALUE_MAPPINGS[zone][cmd][val].models)){
            descVal = COMMANDS[zone][cmd].values[VALUE_MAPPINGS[zone][cmd][val].value].description;
            values[val] = {desc: descVal, type: 'string', native: VALUE_MAPPINGS[zone][cmd][val].value};
        } else if (val === 'INTRANGES'){
            const arrRanges = VALUE_MAPPINGS[zone][cmd].INTRANGES;
            arrRanges.forEach((key) => {
                descVal = COMMANDS[zone][cmd].values[key.range].description;
                if (in_modelsets(key.models)){
                    values[key.range] = {desc: descVal, type: 'range'};
                }
            });
        }
        cb();
    }, (err) => {
        result.values = values;
        result.desc = desc;
        callback(err, result);
    });
};

self.discover = function (){
    /*
      discover([options, ] callback)
      Sends broadcast and waits for response callback called when number of devices or timeout reached
      option.devices    - stop listening after this amount of devices have answered (default: 1)
      option.timeout    - time in seconds to wait for devices to respond (default: 10)
      option.address    - broadcast address to send magic packet to (default: 255.255.255.255)
      option.port       - receiver port should always be 60128 this is just available if you need it
    */
    let callback, timeout_timer, options = {};
    const result = [],
        client = dgram.createSocket('udp4'),
        argv = Array.prototype.slice.call(arguments),
        argc = argv.length;

    if (argc === 1 && typeof argv[0] === 'function'){
        callback = argv[0];
    } else if (argc === 2 && typeof argv[1] === 'function'){
        options = argv[0];
        callback = argv[1];
    } else {
        return;
    }

    options.devices = options.devices || 1;
    options.timeout = options.timeout || 10;
    options.address = options.address || '255.255.255.255';
    options.port = options.port || 60128;

    function close(){
        client.close();
        callback(false, result);
    }

    client.on('error', (err) => {
        self.emit('error', util.format('ERROR (server_error) Server error on %s:%s - %s', options.address, options.port, err));
        client.close();
        callback(err, null);
    }).on('message', (packet, rinfo) => {
        const message = eiscp_packet_extract(packet),
            command = message.slice(0, 3);
        let data;
        if (command === 'ECN'){
            data = message.slice(3).split('/');
            result.push({
                host:     rinfo.address,
                port:     data[1],
                model:    data[0],
                mac:      data[3].slice(0, 12), // There's lots of null chars after MAC so we slice them off
                areacode: data[2]
            });
            self.emit('debug', util.format('DEBUG (received_discovery) Received discovery packet from %s:%s (%j)', rinfo.address, rinfo.port, result));
            if (result.length >= options.devices){
                clearTimeout(timeout_timer);
                close();
            }
        } else {
            self.emit('debug', util.format('DEBUG (received_data) Recevied data from %s:%s - %j', rinfo.address, rinfo.port, message));
        }
    }).on('listening', () => {
        client.setBroadcast(true);
        const onkyo_buffer = eiscp_packet('!xECNQSTN');
        const pioneer_buffer = eiscp_packet('!pECNQSTN');
        self.emit('debug', util.format('DEBUG (sent_discovery) Sent broadcast discovery packet to %s:%s', options.address, options.port));
        client.send(onkyo_buffer, 0, onkyo_buffer.length, options.port, options.address);
        client.send(pioneer_buffer, 0, pioneer_buffer.length, options.port, options.address);
        timeout_timer = setTimeout(close, options.timeout * 1000);
    }).bind(0);
};

function eiscp_packet_extract(packet){
    return packet.toString('ascii', 18, packet.length - 3);
}

function in_modelsets(set){
    return (~config.modelsets.indexOf(set)); // returns true if set is in modelsets false otherwise
}