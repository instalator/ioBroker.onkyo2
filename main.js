'use strict';
const utils = require('@iobroker/adapter-core');
const eiscp = require('./lib/eiscp');
let adapter, old_states;
let states = {
    main:  {},
    zone2: {},
    zone3: {},
    zone4: {},
    dock:  {}
};

const objects = {
    volume: {role: 'media.volume', name: 'Media volume', type: 'string', read: true, write: true}
};

function startAdapter(options){
    return adapter = utils.adapter(Object.assign({}, options, {
        name:        'onkyo2',
        ready:       main,
        unload:      (callback) => {
            try {
                eiscp.close();
                adapter.log.info('cleaned everything up...');
                callback();
            } catch (e) {
                callback();
            }
        },
        stateChange: (id, state) => {
            if (state){
                adapter.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
                if (state && !state.ack){
                    const ids = id.split('.');
                    const zone = ids[2];
                    const cmd = ids[3];
                    const val = state.val.toString();
                    if (zone === 'command'){
                        if (state.val.match(/^[A-Z0-9\-+]+$/)){
                            eiscp.raw(state.val);
                        } else {
                            eiscp.command(state.val);
                        }
                        return;
                    }
                    if (~ids.indexOf('volume')){
                        SetIntervalVol(cmd, val, zone);
                    } else {
                        eiscp.command(zone, cmd, val);
                    }
                }
            } else {
                adapter.log.info(`state ${id} deleted`);
            }
        },
    }));
}

function parse(zone, cmd, val, iscp){
    iscp = iscp.slice(0, 3);
    val = val || null;
    if (cmd === 'net-usb-listinfo'){
        console.log();
    }
    if (iscp === 'NLT'){
        // 00 2 2 0000 0000 00 0 1 04 00 00
        //"xx u y cccc iiii ll s r aa bb ss nnn...nnn"	"NET/USB List Title Info
        // cccc - Current Cursor Position (HEX 4 letters)
        // iiii : Number of List Items (HEX 4 letters)
        // ll : Number of Layer(HEX 2 letters)
        // r : Reserved (1 leters, don't care)
        //nnn...nnn : Character of Title Bar (variable-length, 64 Unicode letters [UTF-8 encoded] max)"
        const NLT = {
            1: { // xx Service Type
                '00': 'Music Server (DLNA)',
                '01': 'Favorite',
                '02': 'vTuner',
                '03': 'SiriusXM',
                '04': 'Pandora',
                '05': 'Rhapsody',
                '06': 'Last.fm',
                '07': 'Napster',
                '08': 'Slacker',
                '09': 'Mediafly',
                '0A': 'Spotify',
                '0B': 'AUPEO!',
                '0C': 'radiko',
                '0D': 'e-onkyo',
                '0E': 'TuneIn Radio',
                '0F': 'MP3tunes',
                '10': 'Simfy',
                '11': 'Home Media',
                '12': 'Deezer',
                '13': 'iHeartRadio',
                '18': 'Airplay',
                '1A': 'onkyo music',
                '1B': 'TIDAL',
                '41': 'FireConnect',
                'F0': 'USB/USB(Front)',
                'F1': 'USB(Rear)',
                'F2': 'Internet Radio',
                'F3': 'NET',
                'FF': 'None'
            },
            2: { //u UI Type
                0: 'List',
                1: 'Menu',
                2: 'Playback',
                3: 'Popup',
                4: 'Keyboard',
                5: 'Menu List'
            },
            3: { //y Layer Info
                0: 'NET TOP',
                1: 'Service Top,DLNA/USB/iPod Top',
                2: 'under 2nd Layer'
            },
            4: { //s Start Flag
                0: 'Not First',
                1: 'First'
            },
            5: { //aa : Icon on Left of Title Bar
                '00': 'Internet Radio',
                '01': 'Server',
                '02': 'USB',
                '03': 'iPod',
                '04': 'DLNA',
                '05': 'WiFi',
                '06': 'Favorite',
                '10': 'Account(Spotify)',
                '11': 'Album(Spotify)',
                '12': 'Playlist(Spotify)',
                '13': 'Playlist-C(Spotify)',
                '14': 'Starred(Spotify)',
                '15': 'What"s New(Spotify)',
                '16': 'Track(Spotify)',
                '17': 'Artist(Spotify)',
                '18': 'Play(Spotify)',
                '19': 'Search(Spotify)',
                '1A': 'Folder(Spotify)',
                'FF': 'None'
            },
            6: { //bb : Icon on Right of Title Bar
                '00': 'Music Server (DLNA)',
                '01': 'Favorite',
                '02': 'vTuner',
                '03': 'SiriusXM',
                '04': 'Pandora',
                '05': 'Rhapsody',
                '06': 'Last.fm',
                '07': 'Napster',
                '08': 'Slacker',
                '09': 'Mediafly',
                '0A': 'Spotify',
                '0B': 'AUPEO!',
                '0C': 'radiko',
                '0D': 'e-onkyo',
                '0E': 'TuneIn Radio',
                '0F': 'MP3tunes',
                '10': 'Simfy',
                '11': 'Home Media',
                '12': 'Deezer',
                '13': 'iHeartRadio',
                '18': 'Airplay',
                '1A': 'onkyo music',
                '1B': 'TIDAL',
                '41': 'FireConnect',
                'F0': 'USB/USB(Front)',
                'F1': 'USB(Rear)',
                'FF': 'None'
            },
            7: { //ss : Status Info
                '00': 'None',
                '01': 'Connecting',
                '02': 'Acquiring License',
                '03': 'Buffering',
                '04': 'Cannot Play',
                '05': 'Searching',
                '06': 'Profile update',
                '07': 'Operation disabled',
                '08': 'Server Start-up',
                '09': 'Song rated as Favorite',
                '0A': 'Song banned from station',
                '0B': 'Authentication Failed',
                '0C': 'Spotify Paused(max 1 device)',
                '0D': 'Track Not Available',
                '0E': 'Cannot Skip'
            }
        };
        let ServiceType = NLT[val.substr(0, 2)];
    }
    if (iscp === 'NLS'){
        console.log(val);
    }
    if (iscp === 'NTI'){
        //Old IdeasISCP!1NTIGoing Home val = val.replace();
    }
    if (iscp === 'NST'){
        //- "NST" - NET/USB Play Status
        //"prs"
        const NST = {
            1: {
                'S': 'STOP',
                'P': 'Play',
                'p': 'Pause',
                'F': 'FF',
                'R': 'FR',
                'E': 'EOF'
            },
            2: {
                '-': 'Off',
                'R': 'All',
                'F': 'Folder',
                '1': 'Repeat 1',
                'x': 'disable'
            },
            3: {
                '-': 'Off',
                'S': 'All',
                'A': 'Album',
                'F': 'Folder',
                'x': 'disable'
            }
        };
    }
    if (iscp === 'IFA'){
        // "IFA" - Audio Infomation Command
        // "a..a,b..b,c…c,d..d,e…e,f…f,"
        //Infomation of Audio(Same Immediate Display ',' is separator of infomations)
        /*a...a: Audio Input Port
        b…b: Input Signal Format
        c…c: Sampling Frequency
        d…d: Input Signal Channel
        e…e: Listening Mode
        f…f: Output Signal Channel*/
        if(~val.indexOf(',')){
            let arr = val.split(',');
        }
    }
    if (iscp === 'IFV'){
        // "IFV" - Video Infomation Command
        /*"a..a,b..b,c…c,d..d,e…e,f…f,g…g,h…h,i…i,"
        infomation of Video(Same Immediate Display ',' is separator of infomations)
        a…a: Video Input Port
        b…b: Input Resolution, Frame Rate
        c…c: RGB/YCbCr
        d…d: Color Depth
        e…e: Video Output Port
        f…f: Output Resolution, Frame Rate
        g…g: RGB/YCbCr
        h…h: Color Depth
        i...i: Picture Mode*/
        let arr = val.split(',');
    }


    if (states[zone][cmd] !== undefined){
        states[zone][cmd].val = val;
    } else {
        adapter.log.error('zone ' + zone + ' cmd ' + cmd + ' val ' + val);
    }
    creatObjects(states);
}

function creatObjects(states){
    //debug('setStates');
    let ids = '';
    Object.keys(states).forEach((zone) => {
        Object.keys(states[zone]).forEach((cmd) => {
            ids = zone + '.' + cmd;
            if (!old_states[zone].hasOwnProperty(cmd)){
                old_states[zone][cmd] = {
                    val:    null,
                    values: states[zone][cmd].values,
                    desc:   states[zone][cmd].desc
                };
                old_states[zone][cmd].val = null;
            }
            if (states[zone][cmd].val !== old_states[zone][cmd].val){
                old_states[zone][cmd].val = states[zone][cmd].val;
                setObject(ids, zone, cmd, states[zone][cmd].val);
            }
        });
    });
}

function setObject(ids, zone, cmd, val){
    //console.log(states);
    if (Array.isArray(val)) val = val.join(', ');
    adapter.getObject(ids, (err, obj) => {
        let common = {
            name: states[zone][cmd].desc, desc: states[zone][cmd].desc, type: 'string', role: 'state'
        };
        common.states = {};
        Object.keys(states[zone][cmd].values).forEach((key) => {
            common.states[key] = key;
        });
        if (objects[cmd] !== undefined){
            common.name = objects[cmd].name;
            common.desc = objects[cmd].name;
            common.role = objects[cmd].role;
            common.type = objects[cmd].type;
            if (objects[cmd].unit !== undefined) common.unit = objects[cmd].unit;
            if (objects[cmd].min !== undefined) common.min = objects[cmd].unit;
            if (objects[cmd].max !== undefined) common.max = objects[cmd].unit;
            if (objects[cmd].states !== undefined) common.states = objects[cmd].states;
            common.read = objects[cmd].read;
            common.write = objects[cmd].write;
        }
        if (err || !obj){
            adapter.setObject(ids, {
                type: 'state', common: common, native: {}
            });
            adapter.setState(ids, {val: val, ack: true});
        } else {
            if (JSON.stringify(obj.common) !== JSON.stringify(common) || objects[cmd] !== undefined){
                adapter.extendObject(ids, {common: common});
            }
            adapter.setState(ids, {val: val, ack: true});
        }
    });
}

function getCommands(){
    const zone = ['main', 'zone2', 'zone3', 'zone4', 'dock'];
    zone.forEach((_zone) => {
        eiscp.get_commands(_zone, (err, cmds) => {
            cmds.forEach((cmd) => {
                eiscp.get_command(_zone, cmd, (err, values) => {
                    states[_zone][cmd] = {values: values.values, val: null, desc: values.desc};
                    setObject(_zone + '.' + cmd, _zone, cmd, states[_zone][cmd].val);
                    eiscp.command(_zone, cmd, 'query');
                });
            });
        });
    });
}

function connect(options){
    adapter.log.info('Connecting to AVR ' + adapter.config.host + ':' + adapter.config.port);
    eiscp.connect(options);

    eiscp.on('connect', () => {
        adapter.log.info('Successfully connected to AVR');
        adapter.setState('info.connected', true, true);
        getCommands();
    });

    eiscp.on('close', () => {
        adapter.log.info('AVR disconnected');
        adapter.setState('info.connected', false, true);
    });

    eiscp.on('data', (res) => {
        adapter.log.debug('Response message: ' + JSON.stringify(res));
        if (res.command instanceof Array){
            res.command.forEach((cmd) => {
                parse(res.zone, cmd, res.argument, res.iscp_command);
            });
        } else {
            parse(res.zone, res.command, res.argument, res.iscp_command);
        }
        //parse(res.zone, 'command', res.iscp_command);
    });
    eiscp.on('error', (e) => {
        adapter.log.error('Error: ' + e);
    });
    eiscp.on('debug', (message) => {
        adapter.log.debug(message);
    });
}

function main(){
    adapter.subscribeStates('*');
    old_states = JSON.parse(JSON.stringify(states));
    const options = {
        host:            adapter.config.host || null,
        port:            adapter.config.port || 60128,
        reconnect:       true,
        verify_commands: true
    };
    connect(options);
}

function SetIntervalVol(cmd, newVal, zone){
    let volume = states[zone].volume.val;
    if (newVal >= volume + 10){
        const interval = setInterval(() => {
            volume = volume + 2;
            if (volume >= newVal){
                volume = newVal;
                clearInterval(interval);
            }
            eiscp.command(zone, cmd, volume);
        }, 500);
    } else {
        eiscp.command(zone, cmd, newVal);
    }
}

if (module.parent){
    module.exports = startAdapter;
} else {
    startAdapter();
}