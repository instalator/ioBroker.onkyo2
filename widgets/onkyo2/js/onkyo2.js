/*
    Onkyo Widget-Set
    Copyright 2020 instalator<vvvalt@mail.ru>
*/
'use strict';

if (vis.editMode){
    $.extend(true, systemDictionary, {
        'oid_list':         {'en': 'List items', 'de': 'List items', 'ru': 'List items'},
        'oid_select':       {'en': 'Select item', 'de': 'Select item', 'ru': 'Select item'},
        'group_styles':     {'en': 'Prop', 'de': 'Prop', 'ru': 'Prop'},
        'angle':            {'en': 'angle', 'de': 'angle', 'ru': 'angle'},
        'distance':         {'en': 'distance', 'de': 'distance', 'ru': 'distance'},
        'displayed_length': {'en': 'displayed length', 'de': 'displayed length', 'ru': 'displayed length'},
        'rotation':         {'en': 'rotation', 'de': 'rotation', 'ru': 'rotation'},
        'item_height':      {'en': 'item height', 'de': 'item height', 'ru': 'item height'},
    });
}

$.extend(true, systemDictionary, {
    'Instance': {'en': 'Instance', 'de': 'Instanz', 'ru': 'Инстанция'}
});

vis.binds.onkyo2 = {
    version:     '1.0.0',
    showVersion: function (){
        if (vis.binds.onkyo2.version){
            console.log('Version onkyo2: ' + vis.binds.onkyo2.version);
            vis.binds.onkyo2.version = null;
        }
    },
    states:      {
        oid_list:   {val: 0, role: 'media.menu', onkyo2: true, selector: ''},
        oid_select: {val: [], role: 'media.menu.item', onkyo2: true, selector: ''},
    },
    /**************************************************************************/
    Navigation:  function (widgetID, view, data, style){
        var $div = $('#' + widgetID);
        // if nothing found => wait
        if (!$div.length){
            return setTimeout(function (){
                vis.binds.onkyo2.Navigation(widgetID, view, data, style);
            }, 100);
        }

        function setNavList(val){
            $('#onkyo-navigation').WSlot('rollTo', val);
        }

        function onClick(){
            $('#onkyo-navigation').off('click', '.wslot-item-selected');
            $('#onkyo-navigation').on('click', '.wslot-item-selected', function (){
                //let text = $('#onkyo-navigation').WSlot('getText');
                let item = $('#onkyo-navigation').WSlot('get');
                vis.setValue(data.oid_select, item);
                $('.wslot-item-selected').effect('pulsate', {times: 5}, 3000);
            });
        }

        function updateNavList(val){
            console.log('onkyo2 ' + JSON.stringify(data));
            if (val !== 'null'){
                var list = JSON.parse(val);
                console.log('updateNavList = ' + list);
                if (list && list.length > 0){
                    $('#onkyo-navigation').WSlot({
                        items:            list,
                        center:           'center',
                        angle:            data.angle,
                        distance:         data.distance,
                        displayed_length: data.displayed_length,
                        rotation:         data.rotation,
                        item_height:      data.item_height,
                    }).on('WSlot.change', function (e, index){
                        onClick();
                    });
                    onClick();
                }
            }
            setNavList(vis.states[data.oid_select + '.val']);
        }

        // subscribe on updates of value
        var bound = [];
        if (data.oid_list){
            bound.push(data.oid_list + '.val');
            vis.states.bind(data.oid_list + '.val', function (e, newVal, oldVal){
                console.log('oid_list = ' + newVal);
                updateNavList(newVal);
            });
        }
        if (data.oid_select){
            bound.push(data.oid_select + '.val');
            vis.states.bind(data.oid_select + '.val', function (e, newVal, oldVal){
                console.log('oid_select = ' + newVal);
                setNavList(newVal);
            });
        }
        if ($div.length){
            updateNavList(vis.states[data.oid_list + '.val']);
            setNavList(vis.states[data.oid_select + '.val']);
        }
        if (bound.length){
            $div.data('bound', bound);
        }
    },
    /************************************************************************/
    CodecInfo:   function (widgetID, view, data, style){
        var $div = $('#' + widgetID);
        // if nothing found => wait
        if (!$div.length){
            return setTimeout(function (){
                vis.binds.onkyo2.CodecInfo(widgetID, view, data, style);
            }, 100);
        }
        function SetCodecInfo(val){
            if (val){
                $('.onkyo2info > .codec').css('backgroundImage', 'url(./widgets/onkyo2/img/audio/' + val + '.png)');
            }
        }
        // subscribe on updates of value
        if (data.oid_codec){
            vis.states.bind(data.oid_codec + '.val', function (e, newVal, oldVal){
                SetCodecInfo(newVal);
            });
        }
        if (vis.editMode){
            SetCodecInfo('dtshd_ma');
        } else {
            SetCodecInfo(vis.states[data.oid_codec + '.val']);
        }
    }
    /***********************************************************************/

};

if (vis.editMode){
    vis.binds.onkyo2.onCommonChanged = function (widgetID, view, newId, attr, isCss, oldValue, type){
        if (oldValue && oldValue !== 'nothing_selected') return;
        console.log('---------: ' + widgetID + ' - ' + view + ' - ' + newId + ' - ' + attr + ' - ' + isCss);

        var changed = [];
        var obj = vis.objects[newId];

        // If it is real object and SETPOINT
        if (obj && obj.common && obj.type === 'state'){
            var roles = [];
            var s;
            for (s in vis.binds.onkyo2.states) {
                if (!vis.binds.onkyo2.states.hasOwnProperty(s) || !vis.binds.onkyo2.states[s][type]) continue;
                if (vis.views[view].widgets[widgetID].data[s]) continue;

                roles.push(vis.binds.onkyo2.states[s].role);
            }
            if (roles.length){
                var result = vis.findByRoles(newId, roles);
                if (result){
                    var name;
                    for (var r in result) {
                        if (!result.hasOwnProperty(r)) continue;
                        name = null;
                        for (s in vis.binds.onkyo2.states) {
                            if (!vis.binds.onkyo2.states.hasOwnProperty(s)) continue;
                            if (vis.binds.onkyo2.states[s].role === r){
                                changed.push(s);
                                vis.views[view].widgets[widgetID].data[s] = result[r];
                                vis.widgets[widgetID].data[s] = result[r];
                                break;
                            }
                        }
                    }
                }
            }
        }
        return changed;
    };

    vis.binds.onkyo2.onNavigationBrowserChanged = function (widgetID, view, newId, attr, isCss, oldValue){
        return vis.binds.onkyo2.onCommonChanged(widgetID, view, newId, attr, isCss, oldValue, 'onkyo2');
    };
}
vis.binds.onkyo2.showVersion();
