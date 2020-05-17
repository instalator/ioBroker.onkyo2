/*
Изменения в файле:
- переименованы ячейки А1 на "Command Support List"
- удалены серые "DIF" - Display Information Command 
- разделены команды "SPA"/"SPB", "ZPA"/"ZPB"
- Обьеденены "RAS" - Re-EQ Command  и "RAS" - Cinema Filter Command 
- удалены строки с описаниями между команд
- удалена строка с 906 - "CTS" - Currect　Track Status（No.）так как дубль имени и не используется.
- Для "BCS" - Battery Charge Status Command (Battery Model Only) удалено описание в колонках С*
- в NET удалена строка "NTC" - Net-Tune Operation Command (Net-Tune Model Only before TX-NR1000)
- Для зоны 2 добавлено для уникализации имен: //Иначе не создать уникальный обьект command_mappings
    * "TUN" - Tuning2 Command (дубль "TUZ" - Tuning Command )
    * "PRS" - Preset2 Command  (дубль "PRZ" - Preset Command )
    * "NTC" - Net-Tune2/Network Operation Command(Net-Tune Model Only) (дубль "NTZ" - Net-Tune/Network Operation Command(Network Model Only))
- Для зоны 3 добавлено для уникализации имен: //Иначе не создать уникальный обьект command_mappings
    * "TUN" - Tuning2 Command  (дубль "TU3" - Tuning Command )
    * "PRS" - Preset2 Command  (дубль "PR3" - Preset Command )
    * "NTC" - Net-Tune/Network Operation Command(Net-Tune Model Only) (дубль "NT3" - Network-Tune/Network Operation Command(Network Model Only))
- Для зоны dock добавлено для уникализации имен: //Иначе не создать уникальный обьект command_mappings
    * "NLS" - NET/USB ListInfo (дубль "NLA" - NET/USB List Info(All item, need processing XML data, for Network Control Only))
   
 */


const fs = require('fs');
const XLSX = require('xlsx');
const workbook = XLSX.readFile('./ISCP-V1.38_2017_mod.xlsx', {
    raw:         true,
    cellFormula: false,
    cellHTML:    false,
    cellNF:      false,
    cellStyles:  false,
    cellText:    true,
    bookFiles:   true,
    sheets:      ['CMND(MAIN)', 'CMND(ZONE2)', 'CMND(ZONE3)', 'CMND(ZONE4)', 'CMND(NET USB)']
});

let dataSheet = {
    main:  XLSX.utils.sheet_to_json(workbook.Sheets['CMND(MAIN)'], {defval: ''}),
    zone2: XLSX.utils.sheet_to_json(workbook.Sheets['CMND(ZONE2)'], {defval: ''}),
    zone3: XLSX.utils.sheet_to_json(workbook.Sheets['CMND(ZONE3)'], {defval: ''}),
    zone4: XLSX.utils.sheet_to_json(workbook.Sheets['CMND(ZONE4)'], {defval: ''}),
    dock:  XLSX.utils.sheet_to_json(workbook.Sheets['CMND(NET USB)'], {defval: ''})
};

let eiscpCommands = {
    'commands':         {},
    'modelsets':        {},
    'command_mappings': {},
    'value_mappings':   {}
};

let modelsets = {};

const nullRow = (dataRow) => {
    let res = true;
    for (let key in dataRow) {
        if (~key.indexOf('__EMPTY')){
            if (dataRow[key]){
                res = false;
            }
        }
    }
    return res;
};

start();

function start(){
    for (const zone in dataSheet) {
        parse(zone, dataSheet[zone]);
    }
    fs.writeFile('eiscp-commands.json', JSON.stringify(eiscpCommands), (err) => {
        if (err) return console.log(err);
        console.log('eiscp-commands.json created!');
    });
}

function getmaxEmpty(obj){
    let arr = [];
    Object.keys(obj).forEach((key) => { //__EMPTY_182
        key = key.match(/\d+/g);
        arr.push(key && key[0]);
    });
    return Math.max.apply(null, arr);
}


function parse(zone, data){
    /* Добавляем в таблицу доп колонки моделей, если в столбце указано более одной модели. И одновременно переименовываем первоначальные наименования если их несколько в ячейке*/
    Object.keys(data[0]).forEach((_key, index) => {
        let key = data[0][_key];
        if (key && ~key.indexOf('TX-NR5000ETX-NA1000')){
            key = key.replace('TX-NR5000ETX-NA1000', 'TX-NR5000\r\nETX-NA1000');
        }
        if (~key.indexOf('\r\n')){
            let ver = false;
            if (~key.indexOf('Ver2')) ver = true;
            let model = key.replace('\r\n(Ether)', '').replace('\r\n(Ver2.0)', '').split('\r\n');
            if (ver){
                model.forEach((name, n) => {
                    model[n] = name + '(2)';
                });
            }
            const firstName = model[0];
            const prefixName = firstName.match(/^[^0-9]*/g)[0];
            const empty = '__EMPTY_' + (index - 1);
            data[0][empty] = firstName;
            model.splice(0, 1);
            model.forEach((name) => {
                if (~name.indexOf('/')){ //Если в моделе указан знак / то следом идет модель без префикса названия - исправляем.
                    name = name.replace('/', prefixName);
                }
                const maxEmpty = '__EMPTY_' + (getmaxEmpty(data[index]) + 1);
                data.forEach((rowObj, index) => {
                    if (index === 0){
                        data[index][maxEmpty] = name;
                    } else {
                        data[index][maxEmpty] = data[index][empty];
                    }
                });
            });
        }
    });

    /* Получаем полный список моделей */
    let models = [];
    Object.keys(data[0]).forEach((key, i) => {
        models[i] = data[0][key];
    });
    models.splice(0, 2);

    /* Сохраняем в файл для проверки */
    let ws = XLSX.utils.json_to_sheet(data);
    let wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'SheetJS');
    XLSX.writeFile(wb, 'out_file_' + zone + '.xls');

    /* парсим команды и их значения */
    let cmds = {}, cmdShort, cmdName;
    data.forEach((dataRow, index) => {
        if (index > 0){
            Object.keys(dataRow).forEach((key, i) => {
                if (key === 'Command Support List' && index > 0 && i === 0 && nullRow(dataRow)){
                    dataRow[key].replace(/\s+|"|“|”/g, '').replace(/~/g, '-').replace('xx', '{xx}').replace(/…/g, '..');
                    const cmdArr = dataRow[key].match(/^.*?"(.*?)".*?-.*?(.*)/);
                    if (cmdArr){
                        const cmdDesc = cmdArr[2].replace(/^\s+|\s+$/g, '');
                        cmdShort = cmdArr[1].replace(/\s+/g, '')
                            .replace(/"/g, '');
                        if (cmds.hasOwnProperty(cmdShort)){
                            console.error('Найден дубль команды ' + cmdShort);
                            process.abort();
                        }
                        //cmdName = parseCmdName(cmdDesc);

                        if (cmdShort === 'ADY'){ // Для отладки
                            console.log(zone);
                        }

                        const reg = new RegExp('^' + zone + '|^\\s+' + zone, 'g');
                        cmdName = cmdDesc.toLowerCase()
                            .replace(/operation|command|temporary|master|for\s/g, '')
                            .replace(reg, '')
                            .replace(/\(.* .* .*\)/g, '')
                            .replace(/\/(?!usb|v).* .*/g, '')
                            .replace(/[^\w]/g, ' ')
                            .replace(/^\s+|\s+$/g, '')
                            .replace(/\s\s/g, ' ')
                            .replace(/\s/g, '-')
                            .replace(/--/g, '-');

                        cmds[cmdShort] = {name: cmdName, description: cmdDesc, values: {}};
                    }
                } else {
                    if (i < 1 && cmds[cmdShort] !== undefined && !nullRow(dataRow)){
                        let value = dataRow['Command Support List'].replace(/\s+|"|“|”/g, '')
                            .replace(/~/g, '-')
                            .replace('xx', '{xx}')
                            .replace(/…/g, '..');
                        const desc = dataRow['__EMPTY'].replace(/\s+/g, ' ');
                        let valuesName = dataRow['__EMPTY'].replace(/\s\s\s+/g, ', ').toLowerCase();

                        console.log('<<< ' + cmdShort + ' | ' + cmdName + ' | ' + ' value >' + value + ' | valuesName >' + valuesName + ' | desc >' + desc);
                        const reg = new RegExp('^' + zone + '|^\\s+' + zone, 'g');
                        valuesName = valuesName.replace(/^sets[\s+-,]/, '')
                            .replace(reg, '')
                            .replace(/\(.* .*\)/g, '')
                            .replace(/\/(?!usb|v).* .*/g, '')
                            .replace('wrap-around', '')
                            .replace('gets the', 'query');
                        const spl = cmdName.split('-');
                        spl.forEach((key) => {
                            valuesName = valuesName.replace(key, '');
                        });
                        if (value === 'QSTN') valuesName = 'query';
                        if (value === 'TG') valuesName = 'toggle';
                        if (value === 'UP' || value === 'DOWN' || value === 'UP1' || value === 'DOWN1') valuesName = value.toLowerCase();
                        valuesName = valuesName.replace(/operation|command|temporary|for\s/, '')
                            .replace(/[^\w]/g, ' ')
                            .replace(/^\s+|\s+$/g, '')
                            .replace(/\s\s/g, ' ')
                            .replace(/\s/g, '-')
                            .replace(/--/g, '-');

                        console.log('>>> ' + cmdShort + ' | ' + cmdName + ' | ' + ' value >' + value + ' | valuesName >' + valuesName + ' | desc >' + desc);
                        console.log('--------------------------------------------------------------------------------------');
                        /* парсим диапазонные значения */
                        if (~value.indexOf('-') && value.match(/[-]/g).length < 4 && !~value.indexOf('n') && !~value.indexOf('999') && !~value.indexOf('x')){
                            let minus = false, _ranges, newVal;
                            if (value[0] === '-'){
                                value = value.replace('-', '');
                                minus = true;
                            }
                            _ranges = value.split('-');
                            _ranges = _ranges.map((item) => {
                                if (minus){
                                    newVal = parseInt(item, 16) * -1;
                                    minus = false;
                                } else if (~value.indexOf('255') || ~value.indexOf('099') || ~value.indexOf('499')){
                                    newVal = parseInt(item, 10);
                                } else {
                                    newVal = parseInt(item, 16);
                                }
                                return newVal;
                            });
                            value = _ranges.join(',');
                        }
                        cmds[cmdShort].values[value] = {name: valuesName, description: desc, models: []};
                        /* добавляем в значения поддерживаемые модели в виде set{номер сета}, номер сета тут это на сет на каждую моедель*/
                        const tempSets = [];
                        models.forEach((model, i) => {
                            tempSets.push('set' + (i + 1));
                        });
                        Object.keys(dataRow).forEach((el, index) => {
                            if (index > 1){
                                if (dataRow[el]){
                                    //console.log('> ' + dataRow[el]);
                                    const cell = dataRow[el].toLowerCase();
                                    if (cell && (~cell.indexOf('yes') || ~cell.indexOf('rs232') || ~cell.indexOf('ether'))){
                                        cmds[cmdShort].values[value].models.push(tempSets[index - 2]);
                                    }
                                }
                            }
                        });
                    }
                }
            });
        }
    });

    /* Формируем уникальный набор сетов моделей устройств для каждого параметра */
    let tempStr = [];
    Object.keys(cmds).forEach((cmd) => {
        Object.keys(cmds[cmd].values).forEach((value) => {
            tempStr.push(cmds[cmd].values[value].models.join(','));
        });
    });

    let modelAsStr = [];
    modelAsStr = tempStr.filter((value, index, self) => {
        return self.indexOf(value) === index && value;
    });

    let len, counter = 0;

    modelAsStr.forEach((str, index) => {
        len = Object.keys(modelsets).length;
        modelsets['set' + (len + 1)] = [];
        let arr = str.split(',');
        arr.forEach((set, i) => {
            let num = set.match(/\d+/g)[0];
            modelsets['set' + (len + 1)].push(models[num - 1]);
            Object.keys(cmds).forEach((cmd) => {
                Object.keys(cmds[cmd].values).forEach((value) => {
                    //console.log(cmds[cmd].values[value].models);
                    if (Array.isArray(cmds[cmd].values[value].models) && cmds[cmd].values[value].models.join(',') === str){
                        cmds[cmd].values[value].models = 'set' + (len + 1);
                    }
                });
            });
        });
    });

    /* Формируем окончательный обьект с данными */
    // Формируем обьект command_mappings
    let cmdMap = {};
    Object.keys(cmds).forEach((cmd) => {
        if (cmdMap.hasOwnProperty(cmds[cmd].name)){
            console.error('cmdMap.hasOwnProperty(cmds[cmd].name - ' + cmds[cmd].name + '    cmd = ' + cmd + '    zone = ' + zone);
            //cmds[cmd].name = cmds[cmd].name + '-' + cmd.toLowerCase();
        }
        cmdMap[cmds[cmd].name] = cmd;
    });

    // Формируем обьект value_mappings
    let valMap = {};
    Object.keys(cmds).forEach((cmd) => {
        valMap[cmd] = {};
        Object.keys(cmds[cmd].values).forEach((value) => {
            const val = cmds[cmd].values[value];
            if (~value.indexOf(',')){
                if (typeof valMap[cmd].INTRANGES === 'undefined'){
                    valMap[cmd].INTRANGES = [];
                }
                valMap[cmd].INTRANGES.push({range: value, models: val.models});
            } else {
                valMap[cmd][val.name] = {value: value, models: val.models};
            }
        });
    });

    eiscpCommands['commands'][zone] = cmds;
    eiscpCommands['modelsets'] = modelsets;
    eiscpCommands['command_mappings'][zone] = cmdMap;
    eiscpCommands['value_mappings'][zone] = valMap;


}

