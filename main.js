'use strict';
const utils = require('@iobroker/adapter-core');
const eiscp = require('./lib/eiscp');
const fs = require('fs');
const parser = require('fast-xml-parser');
const backText = '< ... >';
let adapter, old_states, timeOutQuery, objNLS = [backText], buffCover = '', sequence;
const states = {
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
    'net-usb-list-title-info':  {role: 'state', name: 'NET/USB List Title Info(for Network Control Only)', type: 'string', read: true, write: false},
    'net-usb-listinfo':         {role: 'media.menu', name: 'NET/USB ListInfo', type: 'string', read: true, write: false},
    'net-usb-listinfo-current': {role: 'state', name: 'NET/USB List Info Curren Item', type: 'string', read: true, write: false},
    'net-usb-listinfo-select':  {role: 'media.menu.item', name: 'NET/USB List Info Curren Item', type: 'string', read: true, write: false},
    total_track:                {role: 'media', name: 'Number of tracks in the playlist', type: 'number', read: true, write: false},
    'net-usb-jacket-art':       {role: 'media.cover', name: 'Cover', type: 'string', read: true, write: false},
    'input-selector':           {role: 'media.input', name: 'Input Selector Command', type: 'string', read: true, write: true},
};

function startAdapter(options){
    return adapter = utils.adapter(Object.assign({}, options, {
        systemConfig: true,
        name:         'onkyo2',
        ready:        main,
        unload:       (callback) => {
            timeOutQuery && clearTimeout(timeOutQuery);
            try {
                eiscp.close();
                adapter.log.info('cleaned everything up...');
                callback();
            } catch (e) {
                callback();
            }
        },
        stateChange:  (id, state) => {
            if (state){
                if (state && !state.ack){
                    adapter.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
                    const ids = id.split('.');
                    const zone = ids[2];
                    let cmd = ids[3];
                    let val = state.val.toString();
                    if (val === 'true') {
                        val = 'on';
                        states[zone][cmd] = {val: ''};
                    }
                    if (val === 'false') {
                        val = 'off';
                        states[zone][cmd] = {val: ''};
                    }
                    if (zone === 'command'){
                        if (state.val.match(/^[A-Z0-9\-+]+$/)){
                            eiscp.raw(state.val);
                        } else {
                            eiscp.command(zone, cmd, state.val);
                        }
                        return;
                    }
                    if ((cmd === 'system-power' || cmd === 'power') && val === 'false') val = 'standby';
                    if (cmd === 'net-usb-listinfo-select'){
                        val = parseInt(state.val, 10);
                        if (val < 0) val = 0;
                        if (val > 11) val = 11;
                        if (val === 0){ // Return
                            eiscp.raw('NTCRETURN');
                        } else if (val === 11){ // Next
                            eiscp.raw('NLSL');
                        } else {
                            val--;
                            eiscp.raw('NLSL' + val);
                        }
                        return;
                    }
                    if (cmd === 'next' || cmd === 'pause' || cmd === 'play' || cmd === 'prev' || cmd === 'stop'){
                        if (zone === 'dock'){
                            cmd = 'network-usb-key';
                        }
                        adapter.getObject(id, (err, obj) => {
                            if (!err && obj){
                                val = obj.native.val;
                                eiscp.command(zone, cmd, val);
                            }
                        });
                        return;
                    }
                    if (~ids.indexOf('volume')){
                        smoothVolume(cmd, val, zone);
                        return;
                    }
                    if (cmd === 'tuning'){
                        val = val.replace('.', '');
                        const TUN = [
                            'TUNDIRECT',
                            'TUN' + val.substr(0, 1),
                            'TUN' + val.substr(1, 1),
                            'TUN' + val.substr(2, 1),
                            'TUN' + val.substr(3, 1),
                            'TUN' + val.substr(4, 1)
                        ];
                        TUN.forEach((key) => {
                            if (~key.indexOf('TUN') && key !== 'TUNDIRECT'){
                                if (/TUN\d/.test(key)) eiscp.raw(key);
                            } else {
                                eiscp.raw(key);
                            }
                        });
                        return;
                    }
                    eiscp.command(zone, cmd, val);
                    timeOutQuery = setTimeout(() => {
                        eiscp.command(zone, cmd, 'query');
                    }, 2000);
                }
            } else {
                adapter.log.info(`state ${id} deleted`);
            }
        },
    }));
}

let timeOutNLS;

function parse(zone, cmd, val, iscp){
    adapter.log.debug('parse function: zone - ' + zone + ' | cmd - ' + cmd + ' | val - ' + val);
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
        //states.dock.IconLeftTitleBar = {val: NLT.IconLeftTitleBar[val.substr(16, 2)]};
        //states.dock.IconRightTitleBar = {val: NLT.IconRightTitleBar[val.substr(18, 2)]};
        states.dock.StatusInfo = {val: NLT.StatusInfo[val.substr(20, 2)]};
        states.dock.CharacterTitleBar = {val: val.substr(22)};
        if (states.dock.UIType.val === 'Playback'){
            objNLS = [backText, 'Playback'];
            states['dock']['net-usb-listinfo'] = {val: JSON.stringify(objNLS)};
        }

        let cmd = 'NLAL' + (sequence || '0000') + val.substr(12, 2) + '0000' + val.substr(8, 4);
        console.log('** cmd = ' + cmd);
        eiscp.raw(cmd);
    }
    if (iscp === 'NLA'){
        const jsonObj = parser.parse(val.slice(9), {attributeNamePrefix: '', ignoreAttributes: false, parseNodeValue: true, parseAttributeValue: true,});
        sequence = val.substr(1, 4);
        if(val[5] !== 'E'){
            const list = [];
            if (Array.isArray(jsonObj.response.items.item)){
                jsonObj.response.items.item.forEach((key) => {
                    list.push(key);
                });
            } else {
                list[0] = jsonObj.response.items.item;
            }
            states['dock']['NavList'] = {val: JSON.stringify(list)};
        } else {
            adapter.log.warn(jsonObj.response.error.code + ' NLA cmd - ' + jsonObj.response.error.message);
        }
        // NET/USB List Info(All item, need processing XML data, for Network Control Only)
        /*
    * "tzzzzsurr<.....>"
        "t -> responce type 'X' : XML
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
        ---- -> not used" NLAI0000000000
         */
        //states.dock = {val: };
    }
    if (iscp === 'NLS'){
        console.log(' iscp === \'NLS\' - ' + val);
        timeOutNLS && clearTimeout(timeOutNLS);
        const NLS = {
            '0': 'Playing',
            'A': 'Artist',
            'B': 'Album',
            'F': 'Folder',
            'M': 'Music',
            'P': 'Playlist',
            'S': 'Searc',
            'a': 'Account',
            'b': 'Playlist-C',
            'c': 'Starred',
            'd': 'Unstarred',
            'e': 'What \'s New',
        };
        if (val[0] === 'A'){
            console.log(val[0] === 'A');
        }
        if (val[0] === 'U'){
            if (val[1] === '0'){
                objNLS = [backText];
                objNLS.push(val.replace(/U.-/, '')); //val = iconv.decode(val, 'win1251');
                states[zone]['net-usb-listinfo-select'] = {val: 0};
            } else {
                objNLS.push(val.replace(/U.-/, ''));
            }
        }
        if (val[0] === 'C' && val[1] !== '-' && objNLS.length > 1){
            states[zone]['net-usb-listinfo-current'] = {val: NLS[val[2]]};
            states[zone]['net-usb-listinfo-select'] = {val: parseInt(val[1], 10) + 1};
        }

        timeOutNLS = setTimeout(() => {
            if (val[0] !== 'C'){
                objNLS.push(' Next');
            }
            states['dock']['net-usb-listinfo'] = {val: JSON.stringify(objNLS)};
            creatObjects(states);
        }, 500);
        return;
        /* "tlpnnnnnnnnnn"
            t ->Information Type (A : ASCII letter, C : Cursor Info, U : Unicode letter)
            when t = A,
                    l ->Line Info (0-9 : 1st to 10th Line)
                nnnnnnnnn:Listed data (variable-length, 64 ASCII letters max)
                when AVR is not displayed NET/USB List(Keyboard,Menu,Popup…), ""nnnnnnnnn"" is ""See TV"".
                    p ->Property
                - : no
                0 : Playing, A : Artist, B : Album, F : Folder, M : Music, P : Playlist, S : Search
                a : Account, b : Playlist-C, c : Starred, d : Unstarred, e : What's New
            when t = C,
                    l ->Cursor Position (0-9 : 1st to 10th Line, - : No Cursor)
                p ->Update Type (P : Page Infomation Update ( Page Clear or Disable List Info) , C : Cursor Position Update)
            when t = U, (for Network Control Only)
                l ->Line Info (0-9 : 1st to 10th Line)
                nnnnnnnnn:Listed data (variable-length, 64 Unicode letters [UTF-8 encoded] max)
                when AVR is not displayed NET/USB List(Keyboard,Menu,Popup…), ""nnnnnnnnn"" is ""See TV"".
                    p ->Property
                - : no
                0 : Playing, A : Artist, B : Album, F : Folder, M : Music, P : Playlist, S : Search
                a : Account, b : Playlist-C, c : Starred, d : Unstarred, e : What's New"

                //////////////////////////////////////
                "ti"	"select the listed item
                 t -> Index Type (L : Line, I : Index)
                when t = L,
                  i -> Line number (0-9 : 1st to 10th Line [1 digit] )
                when t = I,
                  iiiii -> Index number (00001-99999 : 1st to 99999th Item [5 digits] )"
        */
    }
    if (iscp === 'TUN' || iscp === 'TUZ' || iscp === 'TU3' || iscp === 'TU4'){
        val = val / 100;
    }
    if (iscp === 'NTR'){
        // "cccc/tttt"	NET/USB Track Info (Current Track/Toral Track Max 9999. If Track is unknown, this response is ----)
        states.dock.current_track = {val: parseInt(val.split('/')[0], 10)};
        states.dock.total_track = {val: parseInt(val.split('/')[1], 10)};
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
        states.dock.seek = {val: isNaN(parseFloat((elapsed / duration) * 100).toFixed(4)) ? 0 :parseFloat((elapsed / duration) * 100).toFixed(4)};
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
        /*if (~val.indexOf(',')){
            let arr = val.split(',');
        }*/
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
        let type;
        const types = {
            0: 'bmp',
            1: 'jpeg',
            2: 'url',
            n: 'No Image',
        };
        if (val[0] !== 'n'){
            type = types[val[0]];
        } else {
            val = '../' + adapter.namespace + '/cover.png';
        }
        if (val[1] === '0'){
            buffCover = val.slice(2);
            return;
        }
        if (val[1] === '1'){
            buffCover = buffCover + val.slice(2);
            return;
        }
        if (val[1] === '2'){
            val = '../' + adapter.namespace + '/cover.' + type;
            buffCover = buffCover + val.slice(2);
            const cover = Buffer.from(buffCover, 'hex');
            adapter.writeFile(adapter.namespace, 'cover.' + type, cover);
            buffCover = '';
        }
    }
    if (iscp === 'NTS'){
        // - "NTS" - NET/USB Time Seek
        //    "hh:mm:ss"	"hh: hours(00-99)
        //    mm: munites (00-59)
        //    ss: seconds (00-59)
        //    This command is only available when Time Seek is enable."
        //states.dock.seek = {val: };
    }
    if (iscp === 'NCP'){
        console.log('NCP = ' + val);
    }

    if (cmd && states[zone][cmd] && states[zone][cmd] !== undefined){
        states[zone][cmd].val = val;
    } else {
        adapter.log.error('Parse function Error: zone ' + zone + ' cmd ' + cmd + ' val ' + val);
    }
    creatObjects(states);
}

function creatObjects(states){
    //debug('setStates');
    let ids = '';
    Object.keys(states).forEach((zone) => {
        Object.keys(states[zone]).forEach((cmd) => {
            ids = zone + '.' + cmd;
            if (old_states[zone][cmd] === undefined){
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
        const common = {
            name: states[zone][cmd].desc, desc: states[zone][cmd].desc, type: 'string', role: 'state'
        };
        const native = {};
        if (states[zone][cmd].values !== undefined){
            common.states = {};
            Object.keys(states[zone][cmd].values).forEach((key) => {
                common.states[key] = key;
                native[key] = states[zone][cmd].values[key].native;
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
                type: 'state', common: common, native: native
            },()=>{
                adapter.setState(ids, {val: val, ack: true});
            });
        } else {
            if (JSON.stringify(obj.common) !== JSON.stringify(common) || objects[cmd] !== undefined){
                adapter.extendObject(ids, {common: common, native: native});
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
                    states[_zone][cmd] = {values: values.values, val: null, desc: values.desc, native: values.native};
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
        adapter.setState('info.connection', true, true);
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
    if (!adapter.systemConfig) return;
    adapter.subscribeStates('*');
    old_states = JSON.parse(JSON.stringify(states));
    const options = {
        host:      adapter.config.host || null,
        port:      adapter.config.port || 60128,
        model:     '',
        reconnect: true
    };
    adapter.writeFile(adapter.namespace, 'cover.png', fs.readFileSync(__dirname + '/admin/cover.png'));
    connect(options);
}

function clearStatePlayer(){
    states.dock.current_duration.val = '00:00';
    states.dock.current_elapsed.val = '00:00';
    states.dock.current_track.val = 0;
    states.dock.duration_sec.val = 0;
    states.dock['net-usb-time-info'].val = '00:00/00:00';
    states.dock.seek.val = 0;
}

function smoothVolume(cmd, newVal, zone){
    let volume = states[zone].volume.val;
    if (newVal >= volume + 10){
        const interval = setInterval(() => {
            volume = volume + 2;
            if (volume >= newVal){
                volume = newVal;
                interval && clearInterval(interval);
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