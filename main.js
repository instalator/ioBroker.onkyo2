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
    volume:                     {role: 'media.volume', name: 'Media volume', type: 'string', read: true, write: true},
    duration_sec:               {role: 'media.duration', name: 'Duration track in secunds', type: 'number', read: true, write: false},
    current_duration:           {role: 'media.duration.text', name: 'Playback duration', type: 'string', read: true, write: false},
    current_elapsed:            {role: 'media.elapsed.text', name: 'Playback elapsed', type: 'string', read: true, write: false},
    seek:                       {role: 'media.seek', name: 'Controlling playback seek', type: 'number', unit: '%', min: 0, max: 100, read: true, write: true},
    repeat:                     {role: 'media.mode.repeat', name: 'Repeat control', type: 'string', read: true, write: true, states: {Off: 'off', All: 'all', 'Repeat 1': 'one', 'Folder': 'folder'}},
    shuffle:                    {role: 'media.mode.shuffle', name: 'Shuffle control', type: 'boolean', read: true, write: true, states: {Off: 'off', All: 'all', 'Album': 'album', 'Folder': 'folder'}},
    state_playing:              {role: 'media.state', name: 'Status Play, stop, or pause', type: 'string', read: true, write: false},
    current_track:              {role: 'media.track', name: 'Controlling and state current play track number', type: 'number', read: true, write: true},
    'net-usb-album-name-info':  {role: 'media.album', name: 'Album', type: 'string', read: true, write: false},
    'net-usb-artist-name-info': {role: 'media.artist', name: 'Artist', type: 'string', read: true, write: false},
    'net-usb-title-name':       {role: 'media.title', name: 'Title', type: 'string', read: true, write: false},
    total_track:                {role: 'media', name: 'Number of tracks in the playlist', type: 'number', read: true, write: false},

    
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
                            eiscp.command(zone, cmd, state.val);
                        }
                        return;
                    }
                    /*
                    TUN [
                        'SLI24',
                        'TUNDIRECT',
                        'TUN' + new_val.substr(0,1),
                        'TUN' + new_val.substr(1,1),
                        'TUN' + new_val.substr(2,1),
                        'TUN' + new_val.substr(4,1),
                        'TUN' + new_val.substr(5,1),
                        'TUZQSTN'
                        ];
                     */
                    if (~ids.indexOf('volume')){
                        SetIntervalVol(cmd, val, zone);
                    } else {
                        eiscp.command(zone, cmd, val);
                        setTimeout(() => {
                            eiscp.command(zone, cmd, 'query');
                        }, 500);
                    }
                }
            } else {
                adapter.log.info(`state ${id} deleted`);
            }
        },
    }));
}

function clearStatePlayer(){
    states.dock.current_duration.val = '00:00';
    states.dock.current_elapsed.val = '00:00';
    states.dock.current_track.val = 0;
    states.dock.duration_sec.val = 0;
    states.dock['net-usb-time-info'].val = '00:00/00:00';
    states.dock.seek.val = 0;
}

function parse(zone, cmd, val, iscp){
    console.log('zone - ' + zone + ' | cmd - ' + cmd + ' | val - ' + val);
    val = val || null;
    if (iscp === 'NLT'){
        // 00 2 2 0000 0000 00 0 1 04 00 00
        //"xx u y cccc iiii ll s r aa bb ss nnn...nnn"	"NET/USB List Title Info
        // cccc - Current Cursor Position (HEX 4 letters)
        // iiii : Number of List Items (HEX 4 letters)
        // ll : Number of Layer(HEX 2 letters)
        // r : Reserved (1 leters, don't care)
        //nnn...nnn : Character of Title Bar (variable-length, 64 Unicode letters [UTF-8 encoded] max)"
        const NLT = {
            ServiceType:       { // xx
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
            UIType:            { //u
                0: 'List',
                1: 'Menu',
                2: 'Playback',
                3: 'Popup',
                4: 'Keyboard',
                5: 'Menu List'
            },
            LayerInfo:         { //y
                0: 'NET TOP',
                1: 'Service Top,DLNA/USB/iPod Top',
                2: 'under 2nd Layer'
            },
            StartFlag:         { //s Start Flag
                0: 'Not First',
                1: 'First'
            },
            IconLeftTitleBar:  { //aa 
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
            IconRightTitleBar: { //bb 
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
            StatusInfo:        { //ss 
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
        states.dock.ServiceType = {val: NLT.ServiceType[val.substr(0, 2)]};
        states.dock.UIType = {val: NLT.UIType[val.substr(2, 1)]};
        states.dock.LayerInfo = {val: NLT.LayerInfo[val.substr(3, 1)]};
        states.dock.CurrentCursorPosition = {val: val.substr(4, 4)};
        states.dock.NumberListItems = {val: val.substr(8, 4)};
        states.dock.NumberLayer = {val: val.substr(12, 2)};
        states.dock.StartFlag = {val: NLT.StartFlag[val.substr(14, 1)]};
        states.dock.IconLeftTitleBar = {val: NLT.IconLeftTitleBar[val.substr(16, 2)]};
        states.dock.IconRightTitleBar = {val: NLT.IconRightTitleBar[val.substr(18, 2)]};
        states.dock.StatusInfo = {val: NLT.StatusInfo[val.substr(20, 2)]};
        states.dock.CharacterTitleBar = {val: val.substr(22)};
    }
    if (iscp === 'NLS'){
        console.log(' iscp === \'NLS\' - ' + val);
    }
    if (iscp === 'NTI'){
    }
    if (iscp === 'NTR'){
        // "cccc/tttt"	NET/USB Track Info (Current Track/Toral Track Max 9999. If Track is unknown, this response is ----)
        states.dock.current_track = {val: val.split('/')[0]};
        states.dock.total_track = {val: val.split('/')[1]};
    }
    if (iscp === 'NTR'){
        // - "NTS" - NET/USB Time Seek
        //    "hh:mm:ss"	"hh: hours(00-99)
        //    mm: munites (00-59)
        //    ss: seconds (00-59)
        //    This command is only available when Time Seek is enable."
        //states.dock.seek = {val: };
    }
    if (iscp === 'NLA'){
        // NET/USB List Info(All item, need processing XML data, for Network Control Only)
        /*
        * "tzzzzsurr<.....>"	"t -> responce type 'X' : XML
    zzzz -> sequence number (0000-FFFF)
    s -> status 'S' : success, 'E' : error
    u -> UI type '0' : List, '1' : Menu, '2' : Playback, '3' : Popup, '4' : Keyboard, ""5"" : Menu List
    rr -> reserved
    <.....> : XML data ( [CR] and [LF] are removed )
     If s='S',
     <?xml version=""1.0"" encoding=""UFT-8""?>
     <response status=""ok"">
       <items offset=""xxxx"" totalitems=""yyyy"" >
         <item iconid=""aa"" title=""bbb…bbb"" url=""ccc...ccc""/>
         …
         <item iconid=""aa"" title=""bbb…bbb"" url=""ccc...ccc""/>
       </Items>
     </response>
     If s='E',
     <?xml version=""1.0"" encoding=""UFT-8""?>
     <response status=""fail"">
       <error code=""[error code]"" message=""[error message]"" />
     </response>
    xxxx : index of 1st item (0000-FFFF : 1st to 65536th Item [4 HEX digits] )
    yyyy : number of items (0000-FFFF : 1 to 65536 Items [4 HEX digits] )
    aa : Icon ID
     '29' : Folder, '2A' : Folder X, '2B' : Server, '2C' : Server X, '2D' : Title, '2E' : Title X,
     '2F' : Program, '31' : USB, '36' : Play, '37' : MultiAccount,
     for Spotify
     '38' : Account, '39' : Album, '3A' : Playlist, '3B' : Playlist-C, '3C' : starred,
     '3D' : What'sNew, '3E' : Artist, '3F' : Track, '40' : unstarred, '41' : Play, '43' : Search, '44' : Folder
     for AUPEO!
     '42' : Program
    bbb...bbb : Title
    "
  * "Lzzzzllxxxxyyyy"	"specifiy to get the listed data (from Network Control Only)
    zzzz -> sequence number (0000-FFFF)
    ll -> number of layer (00-FF)
    xxxx -> index of start item (0000-FFFF : 1st to 65536th Item [4 HEX digits] )
    yyyy -> number of items (0000-FFFF : 1 to 65536 Items [4 HEX digits] )"

  * "Izzzzllxxxx----"	"select the listed item (from Network Control Only)
    zzzz -> sequence number (0000-FFFF)
    ll -> number of layer (00-FF)
    xxxx -> index number (0000-FFFF : 1st to 65536th Item [4 HEX digits] )
    ---- -> not used"
         */
        //states.dock.seek = {val: };
    }
    if (iscp === 'NDS'){
        /*- "NDS" - NET Connection/USB Device Status
        "nfr"*/
        const NET = val.substr(0, 1);
        const Front = val.substr(1, 1);
        const Rear = val.substr(2, 1);
        const NDS = {
            NETConnectionstatus: {
                '-': 'no connection',
                'E': 'Ether',
                'W': 'Wireless'
            },
            FrontUSBStatus:      {
                '-': 'no device',
                'i': 'iPod/iPhone',
                'M': 'Memory/NAS',
                'W': 'Wireless Adaptor',
                'B': 'Bluetooth Adaptor',
                'x': 'disable'
            },
            RearUSBStatus:       {
                '-': 'no device',
                'i': 'iPod/iPhone',
                'M': 'Memory/NAS',
                'W': 'Wireless Adaptor',
                'B': 'Bluetooth Adaptor',
                'x': 'disable'
            }
        };
        states.dock.NETConnectionstatus = {val: NDS.NETConnectionstatus[NET]};
        states.dock.FrontUSBStatus = {val: NDS.FrontUSBStatus[Front]};
        states.dock.RearUSBStatus = {val: NDS.RearUSBStatus[Rear]};
    }
    if (iscp === 'NTM'){
        // "hh:mm:ss/hh:mm:ss"	NET/USB Time Info (Elapsed time/Track Time Max 99:59:59. If time is unknown, this response is --:--)
        const current_elapsed = val.split('/')[0];
        const current_duration = val.split('/')[1];
        let duration = current_duration.split(':');
        let elapsed = current_elapsed.split(':');
        if (duration.length > 2){
            duration[0] = parseInt(duration[0], 10) * 3600;
            duration[1] = parseInt(duration[1], 10) * 60;
            duration = duration[0] + duration[1] + parseInt(duration[2], 10);
        } else {
            duration[0] = parseInt(duration[0], 10) * 60;
            duration = duration[0] + parseInt(duration[1], 10);
        }
        if (elapsed.length > 2){
            elapsed[0] = parseInt(elapsed[0], 10) * 3600;
            elapsed[1] = parseInt(elapsed[1], 10) * 60;
            elapsed = elapsed[0] + elapsed[1] + parseInt(elapsed[2], 10);
        } else {
            elapsed[0] = parseInt(elapsed[0], 10) * 60;
            elapsed = elapsed[0] + parseInt(elapsed[1], 10);
        }
        states.dock.duration_sec = {val: duration};
        states.dock.current_duration = {val: current_duration};
        states.dock.current_elapsed = {val: current_elapsed};
        states.dock.seek = {val: parseFloat((elapsed / duration) * 100).toFixed(4)};
    }
    if (iscp === 'NST'){
        const play = val.substr(0, 1);
        const repeat = val.substr(1, 1);
        const shuffle = val.substr(2, 1);
        const NST = {
            play:    {
                'S': 'STOP',
                'P': 'Play',
                'p': 'Pause',
                'F': 'Play', //FF
                'R': 'Play', //FR
                'E': 'EOF'
            },
            repeat:  {
                '-': 'Off',
                'R': 'All',
                'F': 'Folder',
                '1': 'Repeat 1',
                'x': 'disable'
            },
            shuffle: {
                '-': 'Off',
                'S': 'All',
                'A': 'Album',
                'F': 'Folder',
                'x': 'disable'
            }
        };
        states.dock.state_playing = {val: NST.play[play].toLowerCase()};
        states.dock.repeat = {val: NST.repeat[repeat]};
        states.dock.shuffle = {val: NST.shuffle[shuffle]};
        if (states.dock.state_playing === 'stop') clearStatePlayer();
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
        if (~val.indexOf(',')){
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
        //let arr = val.split(',');
    }
    if (iscp === 'NJA'){
        /*
            "tpxxxxxxxxxxxx"	"NET/USB Jacket Art/Album Art Data
            t-> Image type 0:BMP, 1:JPEG, 2:URL, n:No Image
            p-> Packet flag 0:Start, 1:Next, 2:End, -:not used
            xxxxxxxxxxxxxx -> Jacket/Album Art Data (valiable length, 1024 ASCII HEX letters max)"
         */
        /*var covertype = string.substr(0,1)
        adapter.log.debug('Covertype: ' + covertype);
        if (covertype === '0') {
            var image_type = 'bmp';
        }
        if (covertype === '1') {
            var image_type = 'jpg';
        }

        var packetflag = string.substr(1,1)
        adapter.log.debug('packetflag: ' + packetflag);
        if (packetflag === '0') {
            var hextob64 = new Buffer(cmd.iscp_command.substr(5), 'hex').toString('base64')
            imageb64 = hextob64;
        }
        if (packetflag === '1') {
            imageb64 = imageb64 + new Buffer(cmd.iscp_command.substr(5), 'hex').toString('base64');
        }
        if (packetflag === '2') {
            imageb64 = imageb64 + new Buffer(cmd.iscp_command.substr(5), 'hex').toString('base64');
            var img = '<img width="100%" height="100%" title="" alt="cross" src="data:image/' + image_type + ';base64,' + imageb64 +'">';
            var coverurl = '/vis/CoverImage.' + image_type;
            adapter.setState (adapter.namespace + '.' + 'Device.CoverURL', {val: coverurl, ack: true});
            adapter.setState (adapter.namespace + '.' + 'Device.CoverBase64', {val: img, ack: true});
            // safe bas64 data to file
            fs.writeFileSync('/opt/iobroker/iobroker-data/files/vis/CoverImage.' + image_type, imageb64, {encoding: 'base64'}, function(err) {
                adapter.log.debug('Cover file created');
            });
        }*/
    }


    if (states[zone][cmd] && states[zone][cmd] !== undefined){
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
        if (states[zone][cmd].values !== undefined){
            Object.keys(states[zone][cmd].values).forEach((key) => {
                common.states[key] = key;
            });
        }
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