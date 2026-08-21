/**
 * i18n.js — interface strings.
 *
 * English is the source language and the fallback for every key. Ukrainian only
 * overrides what it needs, so a missing key never shows up as a raw id.
 *
 * Language resolution order:
 *   CONFIG.language ('auto' | 'en' | 'uk')
 *     → 'auto': Home Assistant user locale, then browser locale, then 'en'.
 */

export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'uk', label: 'Українська', short: 'UA' },
];

const EN = {
  /* ── top bar ── */
  'ui.lastUpdate': 'Last update',
  'ui.menu': 'Home Assistant menu',
  'ui.settings': 'Settings',
  'ui.language': 'Interface language',
  'ui.close': 'Close',
  'badge.demo': 'DEMO',
  'status.connected': 'ONLINE',
  'status.connecting': 'RECONNECTING…',
  'status.disconnected': 'DISCONNECTED',

  /* ── inverter state ── */
  'inv.online': 'ONLINE',
  'inv.offline': 'OFFLINE',
  'inv.standby': 'STANDBY',
  'inv.fault': 'FAULT',
  'inv.stale': 'NO DATA',
  'inv.unknown': 'UNKNOWN',

  /* ── flow diagram ── */
  'node.solar': 'SOLAR',
  'node.grid': 'GRID',
  'node.house': 'HOUSE',
  'node.battery': 'BATTERY',
  'node.todayEnergy': '{v} kWh today',
  'node.rated': '{v} kW rated',
  'node.importing': 'importing',
  'node.exporting': 'exporting',
  'node.idle': 'idle',

  'flow.coverage': 'Load coverage',
  'flow.calculated': 'calculated',
  'flow.calculatedHint': 'Derived from the power balance — not measured directly',
  'flow.noLoadData': 'no load data',
  'flow.noFlows': 'no active flows',

  'src.solar': 'Solar',
  'src.battery': 'Battery',
  'src.grid': 'Grid',
  'src.house': 'House',
  'series.import': 'Import',
  'series.export': 'Export',

  /* ── cards ── */
  'card.flow': 'ENERGY FLOW',
  'card.battery': 'BATTERY',
  'card.solar': 'SOLAR',
  'card.grid': 'GRID',
  'card.phases': 'PHASES',
  'card.inverter': 'INVERTER',

  'stat.voltage': 'Voltage',
  'stat.current': 'Current',
  'stat.temperature': 'Temperature',
  'stat.health': 'Health (SOH)',
  'stat.timeToFull': 'Time to full',
  'stat.timeToEmpty': 'Time to empty',
  'stat.chargeDischarge': 'Charge / discharge',
  'stat.pvPower': 'PV power',
  'stat.today': 'Today',
  'stat.total': 'Total',
  'stat.importToday': 'Import today',
  'stat.exportToday': 'Export today',
  'stat.frequency': 'Frequency',
  'stat.gridFrequency': 'Grid frequency',
  'stat.efficiency': 'Efficiency',
  'stat.ratedPower': 'Rated power',
  'stat.alarm': 'Alarm',

  'batt.charging': 'CHARGING',
  'batt.discharging': 'DISCHARGING',
  'batt.idle': 'IDLE',

  'grid.toHouse': 'GRID → HOUSE',
  'grid.toGrid': 'HOUSE → GRID',
  'grid.idle': 'IDLE',

  /* ── KPI ── */
  'kpi.pvToday': 'PV TODAY',
  'kpi.consumption': 'CONSUMPTION',
  'kpi.gridImport': 'GRID IMPORT',
  'kpi.gridExport': 'GRID EXPORT',
  'kpi.batteryCharged': 'BATTERY CHARGED',
  'kpi.batteryUsed': 'BATTERY USED',
  'kpi.selfSufficiency': 'SELF-SUFFICIENCY',

  /* ── chart ── */
  'chart.powerToday': 'POWER TODAY',
  'chart.energy7': 'ENERGY · LAST 7 DAYS',
  'chart.energy30': 'ENERGY · LAST 30 DAYS',
  'chart.rangeToday': 'Today',
  'chart.range7d': '7 Days',
  'chart.range30d': '30 Days',
  'chart.noData': 'No data for this period',

  /* ── units (SI symbols; Ukrainian uses Cyrillic ones) ── */
  'unit.W': 'W',
  'unit.kW': 'kW',
  'unit.MW': 'MW',
  'unit.Wh': 'Wh',
  'unit.kWh': 'kWh',
  'unit.MWh': 'MWh',
  'unit.V': 'V',
  'unit.A': 'A',
  'unit.Hz': 'Hz',
  'unit.C': '°C',

  /* ── durations ── */
  'time.days': '{v} d',
  'time.hoursMinutes': '{h} h {m} min',
  'time.minutes': '{m} min',
  'time.agoSec': '{v}s ago',
  'time.agoMin': '{v}m ago',
  'time.agoHour': '{v}h ago',
  'time.agoDay': '{v}d ago',

  /* ── notices ── */
  'notice.demo': '<b>Demo mode.</b> Generated data is shown — no real Home Assistant entities are used.',
  'notice.demoAction': 'Map entities',
  'notice.missing': 'Key entities are not mapped: <b>{list}</b>.',
  'notice.missingAction': 'Map',
  'notice.units': '{n} entities have no <code>unit_of_measurement</code> — units were inferred (<code>{first}</code>{more}).',
  'notice.unitsMore': ' and others',
  'notice.unitsAction': 'Diagnostics',
  'notice.balance': 'Power balance is off by <b>{v}</b>. Check the battery and grid polarity.',
  'notice.balanceAction': 'Polarity',
  'notice.autodetected': 'Entities were detected automatically (<b>{n}</b> roles{device}). Review and save.',
  'notice.autodetectedDevice': ', device <code>{prefix}</code>',
  'notice.autodetectedAction': 'Save',

  /* ── onboarding ── */
  'onboard.title': 'Map your entities',
  'onboard.text': 'Connected to Home Assistant ({n} entities), but the dashboard does not know which of them belong to the Deye inverter.',
  'onboard.auto': 'Detect automatically',
  'onboard.manual': 'Choose manually',
  'onboard.demo': 'Demo mode',

  /* ── settings ── */
  'settings.title': 'Deye Dashboard settings',
  'settings.tab.entities': 'Entities',
  'settings.tab.options': 'Options',
  'settings.tab.diag': 'Diagnostics',
  'settings.tab.export': 'Export',
  'settings.autodetect': 'Auto-detect',
  'settings.clearAll': 'Clear all',
  'settings.cancel': 'Cancel',
  'settings.save': 'Save',
  'settings.entitiesHelp': 'Matching entities found in Home Assistant: <b>{n}</b>. Start typing a name — autocomplete will kick in.',
  'settings.entitiesHelp2': 'The <b>Auto-detect</b> button below fills in everything it can identify.',
  'settings.keyRole': 'key role',
  'settings.notSet': 'not set',
  'settings.requiredField': 'required',
  'settings.suggest': 'Detect automatically',
  'settings.noCandidates': 'No suitable entity found for “{label}”',
  'settings.detected': 'Matched {n} of {total}{device}',
  'settings.detectedDevice': ' (device: {prefix})',
  'settings.cleared': 'All mappings cleared',
  'settings.noSuchEntity': 'no such entity',
  'settings.confMismatch': 'Does not look like this role — check unit_of_measurement and device_class',
  'settings.confMatch': 'Role match: {conf} ({score})',

  'settings.signs': 'Directions and signs',
  'settings.signsHelp': 'Deye integrations report battery and grid power with different polarity. In <code>auto</code> mode the dashboard figures the sign out on its own — from daily energy counters, SOC changes and the power balance.',
  'settings.batterySign': 'Battery: a positive value means',
  'settings.gridSign': 'Grid: a positive value means',
  'settings.loadSign': 'Load',
  'settings.auto': 'auto',
  'settings.signCharge': 'charging',
  'settings.signDischarge': 'discharging',
  'settings.signImport': 'import from the grid',
  'settings.signExport': 'export to the grid',
  'settings.loadAsIs': 'as reported',
  'settings.loadInvert': 'invert the sign',
  'settings.resetLearned': 'Reset learned polarity',
  'settings.resetLearnedDone': 'Learned polarity reset',

  'settings.system': 'System',
  'settings.ratedPower': 'Rated power, kW',
  'settings.batteryCapacity': 'Battery capacity, kWh',
  'settings.staleAfter': 'Data goes stale after, s',
  'settings.dashboardTitle': 'Header title',

  'settings.display': 'Display',
  'settings.language': 'Language',
  'settings.languageAuto': 'Auto (Home Assistant)',
  'settings.phasesBlock': 'Phases card',
  'settings.phasesAuto': 'when data is available',
  'settings.phasesAlways': 'always',
  'settings.phasesNever': 'hidden',
  'settings.defaultRange': 'Default chart range',
  'settings.animations': 'Flow animation',
  'settings.debug': 'Debug mode (console logs)',
  'settings.demoMode': 'Demo mode (test data)',

  'settings.diagMeta': 'Mode: {mode} · connection: {status} · dashboard version: {version}',
  'settings.diagRole': 'Role',
  'settings.diagEntity': 'Entity',
  'settings.diagRaw': 'Raw',
  'settings.diagModel': 'In model',
  'settings.diagStatus': 'Status',
  'settings.diagUnmapped': 'Unmapped roles: {n} ({list})',
  'settings.copyReport': 'Copy support report',
  'settings.reportCopied': 'Report copied to clipboard',
  'settings.copyFailed': 'Could not copy',

  'settings.exportHelp': 'Paste this into <code>configuration.yaml</code> — then the settings are shared across all browsers and devices (right now they live in this browser only).',
  'settings.exportJsonHelp': 'Plain configuration JSON (for backup):',
  'settings.copyYaml': 'Copy YAML',
  'settings.copyJson': 'Copy JSON',
  'settings.pasteJson': 'Paste JSON from clipboard',
  'settings.yamlCopied': 'YAML copied',
  'settings.jsonCopied': 'JSON copied',
  'settings.jsonLoaded': 'Configuration loaded from clipboard',
  'settings.jsonInvalid': 'No valid JSON in the clipboard',

  'sign.charge_positive': '+ = charge',
  'sign.discharge_positive': '+ = discharge',
  'sign.import_positive': '+ = import',
  'sign.export_positive': '+ = export',

  /* ── groups ── */
  'group.solar': 'Solar',
  'group.battery': 'Battery',
  'group.grid': 'Grid',
  'group.load': 'Load / House',
  'group.generator': 'Generator',
  'group.inverter': 'Inverter',
  'group.phases': 'Phases',

  /* ── standalone mode ── */
  'standalone.title': 'Connect to Home Assistant',
  'standalone.text': 'This is standalone mode (the file was opened directly). Enter the Home Assistant address and a <b>long-lived access token</b> (Profile → Security → Long-lived access tokens). Everything is stored in this browser only.',
  'standalone.url': 'URL',
  'standalone.token': 'Token',
  'standalone.connect': 'Connect',
  'standalone.demo': 'Demo mode',
  'fatal': 'Deye Dashboard failed to start: {msg}',
};

const UK = {
  'ui.lastUpdate': 'Останнє оновлення',
  'ui.menu': 'Меню Home Assistant',
  'ui.settings': 'Налаштування',
  'ui.language': 'Мова інтерфейсу',
  'ui.close': 'Закрити',
  'status.connecting': 'ПЕРЕПІДКЛЮЧЕННЯ…',
  'status.disconnected': 'НЕМАЄ ЗВʼЯЗКУ',

  'inv.stale': 'НЕМА ДАНИХ',
  'inv.unknown': 'НЕВІДОМО',

  'node.solar': 'СОНЦЕ',
  'node.grid': 'МЕРЕЖА',
  'node.house': 'ДІМ',
  'node.battery': 'БАТАРЕЯ',
  'node.todayEnergy': '{v} кВт·год за добу',
  'node.rated': 'номінал {v} кВт',
  'node.importing': 'імпорт',
  'node.exporting': 'експорт',
  'node.idle': 'спокій',

  'flow.coverage': 'Покриття навантаження',
  'flow.calculated': 'розрахунок',
  'flow.calculatedHint': 'Виведено з балансу потужностей, а не змірено напряму',
  'flow.noLoadData': 'немає даних про навантаження',
  'flow.noFlows': 'потоків немає',

  'src.solar': 'Сонце',
  'src.battery': 'Батарея',
  'src.grid': 'Мережа',
  'src.house': 'Дім',
  'series.import': 'Імпорт',
  'series.export': 'Експорт',

  'card.flow': 'ПОТОКИ ЕНЕРГІЇ',
  'card.battery': 'БАТАРЕЯ',
  'card.solar': 'СОНЦЕ',
  'card.grid': 'МЕРЕЖА',
  'card.phases': 'ФАЗИ',
  'card.inverter': 'ІНВЕРТОР',

  'stat.voltage': 'Напруга',
  'stat.current': 'Струм',
  'stat.temperature': 'Температура',
  'stat.health': 'Стан (SOH)',
  'stat.timeToFull': 'До повного заряду',
  'stat.timeToEmpty': 'До розряду',
  'stat.chargeDischarge': 'Заряд / розряд',
  'stat.pvPower': 'Потужність PV',
  'stat.today': 'За добу',
  'stat.total': 'Усього',
  'stat.importToday': 'Імпорт за добу',
  'stat.exportToday': 'Експорт за добу',
  'stat.frequency': 'Частота',
  'stat.gridFrequency': 'Частота мережі',
  'stat.efficiency': 'ККД',
  'stat.ratedPower': 'Номінальна потужність',
  'stat.alarm': 'Аварія',

  'batt.charging': 'ЗАРЯД',
  'batt.discharging': 'РОЗРЯД',
  'batt.idle': 'СПОКІЙ',

  'grid.toHouse': 'МЕРЕЖА → ДІМ',
  'grid.toGrid': 'ДІМ → МЕРЕЖА',
  'grid.idle': 'СПОКІЙ',

  'kpi.pvToday': 'СОНЦЕ ЗА ДОБУ',
  'kpi.consumption': 'СПОЖИВАННЯ',
  'kpi.gridImport': 'ІМПОРТ З МЕРЕЖІ',
  'kpi.gridExport': 'ЕКСПОРТ У МЕРЕЖУ',
  'kpi.batteryCharged': 'ЗАРЯД БАТАРЕЇ',
  'kpi.batteryUsed': 'РОЗРЯД БАТАРЕЇ',
  'kpi.selfSufficiency': 'САМОЗАБЕЗПЕЧЕННЯ',

  'chart.powerToday': 'ПОТУЖНІСТЬ ЗА ДОБУ',
  'chart.energy7': 'ЕНЕРГІЯ · 7 ДНІВ',
  'chart.energy30': 'ЕНЕРГІЯ · 30 ДНІВ',
  'chart.rangeToday': 'Доба',
  'chart.range7d': '7 днів',
  'chart.range30d': '30 днів',
  'chart.noData': 'Немає даних за період',

  'unit.W': 'Вт',
  'unit.kW': 'кВт',
  'unit.MW': 'МВт',
  'unit.Wh': 'Вт·год',
  'unit.kWh': 'кВт·год',
  'unit.MWh': 'МВт·год',
  'unit.V': 'В',
  'unit.A': 'А',
  'unit.Hz': 'Гц',

  'time.days': '{v} дн',
  'time.hoursMinutes': '{h} год {m} хв',
  'time.minutes': '{m} хв',
  'time.agoSec': '{v} с тому',
  'time.agoMin': '{v} хв тому',
  'time.agoHour': '{v} год тому',
  'time.agoDay': '{v} дн тому',

  'notice.demo': '<b>Демо-режим.</b> Показано згенеровані дані — реальні entity Home Assistant не використовуються.',
  'notice.demoAction': 'Налаштувати entity',
  'notice.missing': 'Не призначено ключові entity: <b>{list}</b>.',
  'notice.missingAction': 'Призначити',
  'notice.units': 'У {n} entity немає <code>unit_of_measurement</code> — одиниці визначено з даних (<code>{first}</code>{more}).',
  'notice.unitsMore': ' та інші',
  'notice.unitsAction': 'Діагностика',
  'notice.balance': 'Баланс потужностей не сходиться на <b>{v}</b>. Перевірте полярність батареї та мережі.',
  'notice.balanceAction': 'Полярність',
  'notice.autodetected': 'Entity визначено автоматично (<b>{n}</b> ролей{device}). Перегляньте та збережіть.',
  'notice.autodetectedDevice': ', пристрій <code>{prefix}</code>',
  'notice.autodetectedAction': 'Зберегти',

  'onboard.title': 'Призначте entity',
  'onboard.text': 'Дашборд підключено до Home Assistant ({n} entity), але він не знає, які з них належать інвертору Deye.',
  'onboard.auto': 'Знайти автоматично',
  'onboard.manual': 'Вибрати вручну',
  'onboard.demo': 'Демо-режим',

  'settings.title': 'Налаштування Deye Dashboard',
  'settings.tab.entities': 'Entity',
  'settings.tab.options': 'Параметри',
  'settings.tab.diag': 'Діагностика',
  'settings.tab.export': 'Експорт',
  'settings.autodetect': 'Автопідбір',
  'settings.clearAll': 'Очистити все',
  'settings.cancel': 'Скасувати',
  'settings.save': 'Зберегти',
  'settings.entitiesHelp': 'Знайдено придатних entity в Home Assistant: <b>{n}</b>. Почніть вводити назву — спрацює автодоповнення.',
  'settings.entitiesHelp2': 'Кнопка <b>Автопідбір</b> нижче заповнить усе, що вдасться визначити.',
  'settings.keyRole': 'ключова роль',
  'settings.notSet': 'не задано',
  'settings.requiredField': 'обовʼязково',
  'settings.suggest': 'Підібрати автоматично',
  'settings.noCandidates': 'Для «{label}» придатних entity не знайдено',
  'settings.detected': 'Підібрано {n} з {total}{device}',
  'settings.detectedDevice': ' (пристрій: {prefix})',
  'settings.cleared': 'Усі призначення очищено',
  'settings.noSuchEntity': 'такого entity немає',
  'settings.confMismatch': 'Не схоже на цю роль — перевірте unit_of_measurement і device_class',
  'settings.confMatch': 'Відповідність ролі: {conf} ({score})',

  'settings.signs': 'Напрямки та знаки',
  'settings.signsHelp': 'Інтеграції Deye віддають потужність батареї та мережі з різною полярністю. У режимі <code>auto</code> дашборд визначає знак сам — за добовими лічильниками енергії, зміною SOC і балансом потужностей.',
  'settings.batterySign': 'Батарея: додатне значення означає',
  'settings.gridSign': 'Мережа: додатне значення означає',
  'settings.loadSign': 'Навантаження',
  'settings.auto': 'авто',
  'settings.signCharge': 'заряд',
  'settings.signDischarge': 'розряд',
  'settings.signImport': 'імпорт із мережі',
  'settings.signExport': 'експорт у мережу',
  'settings.loadAsIs': 'як є',
  'settings.loadInvert': 'інвертувати знак',
  'settings.resetLearned': 'Скинути вивчену полярність',
  'settings.resetLearnedDone': 'Вивчену полярність скинуто',

  'settings.system': 'Система',
  'settings.ratedPower': 'Номінальна потужність, кВт',
  'settings.batteryCapacity': 'Ємність батареї, кВт·год',
  'settings.staleAfter': 'Дані застаріли через, с',
  'settings.dashboardTitle': 'Заголовок',

  'settings.display': 'Відображення',
  'settings.language': 'Мова',
  'settings.languageAuto': 'Авто (Home Assistant)',
  'settings.phasesBlock': 'Блок фаз',
  'settings.phasesAuto': 'якщо є дані',
  'settings.phasesAlways': 'завжди',
  'settings.phasesNever': 'приховати',
  'settings.defaultRange': 'Діапазон за замовчуванням',
  'settings.animations': 'Анімація потоків',
  'settings.debug': 'Режим відладки (логи в консолі)',
  'settings.demoMode': 'Демо-режим (тестові дані)',

  'settings.diagMeta': 'Режим: {mode} · зʼєднання: {status} · версія дашборда: {version}',
  'settings.diagRole': 'Роль',
  'settings.diagEntity': 'Entity',
  'settings.diagRaw': 'Сире',
  'settings.diagModel': 'У моделі',
  'settings.diagStatus': 'Статус',
  'settings.diagUnmapped': 'Не призначено ролей: {n} ({list})',
  'settings.copyReport': 'Скопіювати звіт для підтримки',
  'settings.reportCopied': 'Звіт скопійовано в буфер обміну',
  'settings.copyFailed': 'Не вдалося скопіювати',

  'settings.exportHelp': 'Вставте це у <code>configuration.yaml</code> — тоді налаштування будуть спільними для всіх браузерів і пристроїв (зараз вони зберігаються лише в цьому браузері).',
  'settings.exportJsonHelp': 'Чистий JSON конфігурації (для резервної копії):',
  'settings.copyYaml': 'Скопіювати YAML',
  'settings.copyJson': 'Скопіювати JSON',
  'settings.pasteJson': 'Вставити JSON з буфера',
  'settings.yamlCopied': 'YAML скопійовано',
  'settings.jsonCopied': 'JSON скопійовано',
  'settings.jsonLoaded': 'Конфігурацію завантажено з буфера',
  'settings.jsonInvalid': 'У буфері немає коректного JSON',

  'sign.charge_positive': '+ = заряд',
  'sign.discharge_positive': '+ = розряд',
  'sign.import_positive': '+ = імпорт',
  'sign.export_positive': '+ = експорт',

  'group.solar': 'Сонце',
  'group.battery': 'Батарея',
  'group.grid': 'Мережа',
  'group.load': 'Навантаження / Дім',
  'group.generator': 'Генератор',
  'group.inverter': 'Інвертор',
  'group.phases': 'Фази',

  'standalone.title': 'Підключення до Home Assistant',
  'standalone.text': 'Це автономний режим (файл відкрито напряму). Вкажіть адресу Home Assistant і <b>long-lived access token</b> (Профіль → Безпека → Токени тривалої дії). Дані зберігаються лише в цьому браузері.',
  'standalone.url': 'URL',
  'standalone.token': 'Токен',
  'standalone.connect': 'Підключитися',
  'standalone.demo': 'Демо-режим',
  'fatal': 'Deye Dashboard не запустився: {msg}',

  /* Role names for the settings screen. English labels from config.js are the
     fallback, so only translated ones need to be listed here. */
  'role.pvPower': 'Потужність PV (сумарна)',
  'role.pvToday': 'Вироблено за добу',
  'role.pvTotal': 'Вироблено всього',
  'role.pv1Power': 'Потужність PV1',
  'role.pv1Voltage': 'Напруга PV1',
  'role.pv1Current': 'Струм PV1',
  'role.pv2Power': 'Потужність PV2',
  'role.pv2Voltage': 'Напруга PV2',
  'role.pv2Current': 'Струм PV2',
  'role.pv3Power': 'Потужність PV3',
  'role.pv3Voltage': 'Напруга PV3',
  'role.pv3Current': 'Струм PV3',
  'role.pv4Power': 'Потужність PV4',
  'role.pv4Voltage': 'Напруга PV4',
  'role.pv4Current': 'Струм PV4',
  'role.batterySoc': 'Заряд батареї (SOC)',
  'role.batteryPower': 'Потужність батареї',
  'role.batteryChargePower': 'Потужність заряду (необовʼязково)',
  'role.batteryDischargePower': 'Потужність розряду (необовʼязково)',
  'role.batteryVoltage': 'Напруга батареї',
  'role.batteryCurrent': 'Струм батареї',
  'role.batteryTemperature': 'Температура батареї',
  'role.batterySoh': 'Стан батареї (SOH)',
  'role.batteryCapacity': 'Ємність батареї (кВт·год)',
  'role.batteryStatus': 'Стан батареї (заряд/розряд)',
  'role.batteryChargeToday': 'Заряджено за добу',
  'role.batteryDischargeToday': 'Розряджено за добу',
  'role.gridPower': 'Потужність мережі (+/-)',
  'role.gridImportPower': 'Потужність імпорту (необовʼязково)',
  'role.gridExportPower': 'Потужність експорту (необовʼязково)',
  'role.gridImportToday': 'Імпорт за добу',
  'role.gridExportToday': 'Експорт за добу',
  'role.gridVoltage': 'Напруга мережі',
  'role.gridFrequency': 'Частота мережі',
  'role.loadPower': 'Потужність навантаження',
  'role.loadToday': 'Споживання за добу',
  'role.loadTotal': 'Споживання всього',
  'role.inverterPower': 'Вихідна потужність інвертора (AC)',
  'role.inverterTemperature': 'Температура інвертора',
  'role.inverterStatus': 'Стан інвертора',
  'role.inverterAlarm': 'Аварія / несправність',
  'role.phaseAPower': 'Потужність L1',
  'role.phaseAVoltage': 'Напруга L1',
  'role.phaseACurrent': 'Струм L1',
  'role.phaseBPower': 'Потужність L2',
  'role.phaseBVoltage': 'Напруга L2',
  'role.phaseBCurrent': 'Струм L2',
  'role.phaseCPower': 'Потужність L3',
  'role.phaseCVoltage': 'Напруга L3',
  'role.phaseCCurrent': 'Струм L3',
};

const DICT = { en: EN, uk: UK };

let current = 'en';
const listeners = new Set();

export function getLanguage() { return current; }

export function isSupported(code) { return Object.prototype.hasOwnProperty.call(DICT, code); }

/** 'auto' → Home Assistant locale, then browser locale, then English. */
export function resolveLanguage(preference, hassLanguage) {
  if (preference && preference !== 'auto' && isSupported(preference)) return preference;
  for (const candidate of [hassLanguage, typeof navigator !== 'undefined' ? navigator.language : null]) {
    const base = String(candidate || '').toLowerCase().split('-')[0];
    if (isSupported(base)) return base;
  }
  return 'en';
}

export function setLanguage(code) {
  const next = isSupported(code) ? code : 'en';
  if (next === current) return false;
  current = next;
  listeners.forEach((cb) => { try { cb(next); } catch (e) { /* ignore */ } });
  return true;
}

export function onLanguageChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }

/**
 * Translate a key. `params` fills `{name}` placeholders.
 * `fallback` is used when the key is missing from every dictionary
 * (that is how English role labels from config.js are reused as-is).
 */
export function t(key, params, fallback) {
  const table = DICT[current] || EN;
  let str = table[key];
  if (str === undefined) str = EN[key];
  if (str === undefined) str = fallback !== undefined ? fallback : key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      str = str.split(`{${name}}`).join(String(value));
    }
  }
  return str;
}

/** Locale tag for Intl (date and number formatting). */
export function localeTag() { return current === 'uk' ? 'uk-UA' : 'en-GB'; }
