# WebCAD Agent API

Интерфейс для агентов (Claude Code и других): создавать и редактировать 3D-модели декларативными
операциями (JSON), находить грани и рёбра геометрическими запросами, получать отчёт о модели
(объёмы, габариты, ошибки фич), снимать скриншоты и экспортировать.

Три способа доступа, один и тот же язык операций:

| Способ | Когда | Как |
| --- | --- | --- |
| **CLI, живой режим** | приложение открыто во вкладке браузера (`npm run dev` / `npm run serve`) — пользователь видит изменения | `npm run agent -- run ops.json` |
| **`window.webcad`** | есть доступ к странице (консоль, browser automation) | `await webcad.run([...])` |
| **CLI, headless** | без браузера: проверить модель, получить STEP/STL или файл документа | `npm run agent -- build ops.json --out m.webcad.json --stl m.stl` |

Файл `.webcad.json` импортируется в приложении: «Документы → Импорт».

## Быстрый старт

```bash
npm run agent -- status                 # подключённые вкладки WebCAD
npm run agent -- create "Пластина"      # новый документ во вкладке
npm run agent -- run '[
  {"op":"variable","name":"w","value":40},
  {"op":"sketch","plane":"top","shapes":[
    {"type":"rect","center":true,"w":"#w","h":30},
    {"type":"circle","c":[0,0],"d":10}]},
  {"op":"extrude","depth":10},
  {"op":"fillet","edges":{"dir":"z"},"radius":3}
]'
npm run agent -- shot /tmp/plate.png iso  # PNG графической области
npm run agent -- run '[{"op":"setVariable","name":"w","value":60}]'
```

Если подключено несколько вкладок (например, Chrome пользователя и встроенный браузер), команда
требует `--tab <id>` (или `WEBCAD_TAB`); id и открытые документы показывает `status`. Если
непонятно, в какой вкладке работать, — спросите пользователя.

## Команды CLI

```
status | docs | open <id|name> | create <name> | state | feature <name>
run <ops.json | - | '[…]'> [--keep-failed]
query '<json>'            {"faces":…} / {"edges":…} / {"parts":…}
measure '<json>'          те же запросы → панель измерений (см. ниже)
animate '<json>'          движение сопряжения по кадрам (см. «Сборки»)
undo | redo | cancel-edit
shot <out.png> [view] [--exploded "<имя>"] [--amount 0…1]
                          view: iso, top, front, right, back, left, bottom, dimetric, trimetric, fit;
                          --exploded — разнесённый вид открытой сборки (--amount — насколько разнесён)
export <stl|step|webcad> <out>
call <method> [json args…]
build <ops.json> [--doc in.webcad.json] [--out out.webcad.json] [--stl f] [--step f] [--name n]
```

`run` применяет все операции **одним шагом отмены**. По умолчанию он атомарный: если какая-то
операция не разобрана (ошибка запроса, нет фичи) или фича не построилась ядром, документ не
меняется, а в отчёте есть `error` / `failed`. `--keep-failed` сохраняет результат с ошибками.

## Соглашения

- Длины — числа в единицах документа (по умолчанию мм) или выражения: `"10 mm"`, `"#w / 2"`,
  `"1 in"`. Углы — числа в градусах или выражения (`"30 deg"`).
- **Размер, заданный строкой, становится управляющим размером эскиза** (`"w":"#w"`), число — просто
  геометрия. Для параметрики заводите переменные и меняйте их через `setVariable`.
- **Производная геометрия** (`derived`): деталь из другой Part Studio — например, двигатель для крепления:
  `[{"op":"studio","name":"Mount"},{"op":"derived","studio":"Part Studio 1","parts":["Motor"]},`
  `{"op":"sketch","plane":{"face":{"normal":"z","pick":"+z"}},"shapes":[…],"use":{"type":"circle","z":30}},…]`.
  Перед сборкой студии её источники собираются заново, так что `state` и экспорт видят их текущее состояние.
  Эскизы источника (`"sketches":["Layout"]`, только эскизы — с `"parts":[]`) приходят в студию под именем
  `"<фича> / <эскиз>"`: `{"op":"extrude","sketch":"Derived 1 / Layout","depth":10}`, так же в `$regions` и в `state`.
- **Конфигурации** (`configuration`, `configure`): модель строится в выбранном варианте; `set`, `setVariable`
  и `suppress` для параметра, который задаёт конфигурация, пишут в ячейку выбранного варианта. Отчёт
  содержит `configuration: [{name, options, chosen, params}]` (`params` — `"Extrude 1.depth"`, `"#w"`,
  `"Sketch 1.dimension 2"`; у входа-переменной `variable: true`, `chosen` — её значение). Экземпляр сборки
  может взять свой вариант: `insert` / `place` с `configuration: {"Size":"Large","len":500}`. Вход-переменная:
  `[{"op":"configuration","name":"len","variable":{"value":40}},{"op":"sketch","shapes":[{"type":"rect","w":"#len","h":20}]},…]`
  и `{"op":"configure","values":{"len":65}}` (`""` — значение по умолчанию).
- Оси мира как в Onshape: Top = XY (нормаль +Z), Front = XZ (x эскиза = +X, y эскиза = +Z),
  Right = YZ (x эскиза = +Y, y эскиза = +Z). Отчёт `state` показывает систему координат каждого
  эскиза (`origin`, `xDir`, `yDir`, `normal`) — в том числе эскизов на гранях.
- Фичи называются как в дереве (`"Extrude 1"`, `"Sketch 2"`); имя можно задать полем `name`.
  Новые фичи вставляются у полосы отката (как в Onshape).

## Операции

| op | Поля |
| --- | --- |
| `variable` | `name`, `value`, `type?` (`length`/`angle`/`number`/`any`), `description?` |
| `setVariable` | `name`, `value` |
| `sketch` | `plane?` (по умолчанию `top`), `shapes` (см. ниже), `name?`, `use?` — рёбра модели (EdgeQuery / список / `"all"`), спроецированные на эскиз фиксированной связанной геометрией (Use): они следуют за источником |
| `extrude` | `sketch?` (по умолчанию последний), `regions?`, `depth?` (10 мм), `end?` (`blind` / `symmetric` / `throughAll` / `{"upToFace": FaceQuery}`), `flip?`, `boolean?` (`new`/`add`/`remove`/`intersect`), `draft?`, `thin?`; `surface: true` — поверхность из кривых эскиза (в том числе незамкнутых) вместо тела; `start?` — начальное смещение: число вдоль направления выдавливания (отрицательное — назад) или `{"from": PlaneSpec}` — от плоскости / грани |
| `revolve` | `sketch?`, `regions?`, `axis`, `angle?` (без него — полный оборот), `boolean?`; `surface: true` — поверхность из кривых эскиза (кривые на самой оси пропускаются) |
| `sweep` | `sketch?` (профиль), `regions?`, `path` — `{"sketch":"Path"}` или `{"edges": EdgeQuery}` (одна цепочка), `keepOrientation?`, `boolean?`; `surface: true` — поверхность из кривых профиля (замкнутая кривая — трубка без торцов) |
| `split` | `parts` (`Parts`: детали и поверхности), `tool` — `PlaneSpec` (плоская грань режет всей плоскостью, с `trim: true` — в своих границах; неплоская грань — в своих) или `{"surface": PartQuery}` (расходуется, если нет `keepTools: true`); первая часть сохраняет имя, при плоскости — со стороны её нормали |
| `fillet` | `edges`, `radius`, `tangentPropagation?` (`false` — только выбранные рёбра, без касательных к ним; по умолчанию цепочка целиком), `vertices?` `[{"at":[x,y,z],"radius":1}]` — переменное скругление: свой радиус в вершинах (ближайшая вершина модели к `at`; в остальных — `radius`), `smooth?` — плавный переход вместо линейного; `points?` `[{"edge": EdgeQuery, "at": 0.5, "radius": 4}]` — свой радиус в точке внутри ребра (`at` — доля длины от начала ребра, 0…1) |
| `chamfer` | `edges`, `distance`, `tangentPropagation?` (как у `fillet`), `type?` (`equal` / `twoDistances` + `distance2` / `distanceAngle` + `angle`), `flip?` — первое расстояние от другой грани |
| `shell` | `faces` (удаляемые грани), `thickness`, `outward?` |
| `deleteFace` | `faces` — грани отверстия / кармана / бобышки целиком или скругление / фаска между плоскими гранями; разрыв закрывают соседние грани (Onshape Delete face с Heal); `heal: false` — грани просто удаляются, деталь становится поверхностью |
| `offsetSurface` | `faces`, `distance?` (0 — копия граней; + наружу из материала), `flip?`; результат — поверхность «Surface N» (в `state` у неё `surface: true`, без объёма) |
| `enclose` | `surfaces` (`Parts`: поверхности, замыкающие объём), `keep?`; результат — твёрдая деталь |
| `thicken` | `surfaces?` (`Parts`: поверхности целиком) и / или `faces?`, `thickness`, `flip?`, `boolean?` |
| `moveFace` | `faces` и одно из: `offset` (плоские грани вдоль своих нормалей, + наружу), `translate: {"direction": AxisSpec, "distance"}`, `rotate: {"axis": AxisSpec, "angle"}`; все грани отверстия / кармана / бобышки двигаются целиком, отдельные плоские — каждая на свою новую плоскость, соседи удлиняются |
| `replaceFace` | `faces` (плоские), `with` — `PlaneSpec`, `offset?` вдоль её нормали (в сторону, куда смотрят грани), `flip?` |
| `hole` | `sketch` (точки эскиза или центры окружностей) и / или `edges?` (центры круговых рёбер, сверлятся в материал), `mates?` (имена соединителей: против их Z), `flip?` — все отверстия в другую сторону, `diameter`, `depth?`, `through?`, `style?` (`simple`/`counterbore`/`countersink`/`counterdrill` — цековка с зенковкой у входа), `cboreDiameter?`, `cboreDepth?`, `csinkDiameter?`, `csinkAngle?`, `csinkRecess?` (зенковка, утопленная в цилиндрическое углубление её диаметра); стандартное отверстие — `iso: {"size":"M6", "type"?: "clearance"\|"tapped", "fit"?: "close"\|"normal"\|"loose", "pitch"?: 1, "tapDepth"?}` вместо `diameter` (диаметры, цековка ISO 4762 и зенковка 90° — из таблиц; глубины по умолчанию — 2 d резьбы и на 3 шага глубже); дюймовое — `ansi: {"size":"1/4" (или "#10"), "type"?, "fit"?, "tpi"?: 28 (UNF; по умолчанию UNC), "tapDepth"?}` (ASME B18.2.8, B1.1, B18.3; зенковка 82°). У резьбового отверстия — косметическая резьба: `state` перечисляет её в `threads` (обозначение, начало, направление, длина, деталь) |
| `linearPattern` | `features` (имена) или `parts`, `direction`, `distance`, `count`, `direction2?`, `distance2?`, `count2?`, `boolean?` |
| `circularPattern` | `features` или `parts`, `axis`, `count`, `angle?` (360°) |
| `mirror` | `features` или `parts`, `plane` |
| `curvePattern` | `features` или `parts`, `path` — `{"sketch":"Path"}` (кривые эскиза) или `{"edges": EdgeQuery}`, `count`, `distance?` (без него — равномерно по всему пути), `flip?` — от другого конца, `orient?` (`false` — копии не поворачиваются), `boolean?` |
| `rib` | `sketch?` (кривые эскиза: отрезки, дуги), `thickness`, `normal?` — ребро растёт по нормали к эскизу (иначе в его плоскости, толщина поровну по обе стороны), `flip?`, `extend?` (`false` — не продлевать кривые до деталей: отрезки — вдоль себя, дуги — по касательным в концах), `draft?` — угол уклона боковых стенок (ребро шире к детали; `draftFlip: true` — уже); ребро идёт от кривой до деталей и сливается с ними |
| `wrap` | `sketch?`, `regions?` (как у `extrude`), `onto` — `FaceQuery` цилиндрической грани, `depth`, `boolean?` (`add` — выдавить из грани, по умолчанию; `remove` — вырезать в неё); плоскость эскиза идёт вдоль оси цилиндра (обычно касается его), области накатываются без растяжения |
| `plane` | `from` (плоскость/грань), `offset` |
| `mateConnector` | `at`: `"origin"` / `{"vertex":[x,y,z], "parallelTo"?: FaceQuery}` (ближайшая вершина) / `{"face": FaceQuery, "point"?: "start"\|"mid"\|"end"}` (центр плоской грани, точка на оси цилиндра, конуса или тора, центр сферы) / `{"edge": EdgeQuery, "point"?: "start"\|"mid"\|"end"\|"center", "parallelTo"?: FaceQuery}` (например центр отверстия, параллельно грани) / `{"sketch":"Sketch 3","point":0}` / `{"mate":"MC1"}`; `between?` — второе расположение того же вида (начало посередине между `at` и `between`); `owner?` — деталь-владелец (`PartQuery`; по умолчанию деталь из `at`), соединитель движется вместе с ней в последующих `transform`; `primaryAxis?` и `secondaryAxis?` (`AxisSpec`), `flip?`, `reorient?` (`"x"`/`"y"`), `rotation?`, `offset?` `[dx, dy, dz]` по своим осям |
| `transform` | `parts`, `from`, `to` — имена mate connector: деталь перемещается так, что `from` совпадает с `to`; `copy?` |
| `boolean` | `type` (`union`/`subtract`/`intersect`), `targets`, `tools`, `keepTools?`; `union` поверхностей сшивает их по общим рёбрам, `subtract` детали из поверхности (поверхность в `targets`) оставляет её часть вне детали |
| `deletePart` | `parts` |
| `part` | `part`, `name?`, `color?` (`#rrggbb`), `opacity?` (0.1…1, 1 — непрозрачная), `hidden?`, `material?` — из библиотеки по id или имени (`steel`, `stainless`, `castIron`, `aluminum`, `brass`, `bronze`, `copper`, `titanium`, `pla`, `abs`, `petg`, `nylon`, `pc`, `acrylic`, `pine`, `plywood`, `glass`) со своей плотностью, или свой с `density` (г/см³); `null` — без материала (масса как у стали). В `state` у деталей — `material` и `mass` (кг) |
| `feature` | `type`, `params` — любая фича с «сырыми» параметрами (sweep, loft, thicken, draft, split, transform, helix…) |
| `derived` | `studio` — имя другой Part Studio документа, `version?` — имя сохранённой версии, из которой её брать (детали — какими были в версии; без браузера — версии из поля `versions` файла проекта), `document?` — имя другого документа, чью версию брать (только в браузере, вместе с `version`), `parts?` — имена её деталей (по умолчанию все, `[]` — ни одной), `sketches?` — имена её эскизов (по умолчанию ни одного; см. выше), `name?`, `configuration?` `{"Size":"Large"}` — вариант конфигурации источника (входы, которых нет, — как выбрано в нём), `at?` — имя соединителя текущей студии: туда встаёт начало координат источника или его соединитель `from?`. Без `at` детали встают там же, где в источнике, и следуют за его изменениями (Onshape Derived); источник, который сам использует текущую студию, — ошибка «circular reference» |
| `set` | `feature`, `params` — изменить параметры существующей фичи (например `{"depth":"20 mm"}`) |
| `delete` / `rename` (`to`) / `suppress` (`value?`) | `feature` |
| `configuration` | `name`, `options` (имена вариантов, первый — по умолчанию), `checkbox?` (вход-флажок: два варианта, «выключен» и «включён», по умолчанию `Off` / `On`), `params?` — столбцы: `{"feature":"Extrude 1","param":"depth"}` (поле диалога; без `param` — `suppressed`, отключена ли фича), `{"feature":"Sketch 1","dimension":2}` (размер эскиза по номеру, с 1 в порядке создания) или `{"variable":"w"}`; `values?` `{"Large":[80,"25 mm",true]}` — по значению на столбец (`null` — значение самой фичи). Заменяет вход с тем же именем. Вместо вариантов — `variable?` `{"value":40,"type":"length"}`: вход-переменная `#name` с любым значением (переменная создаётся в начале списка фич, если её нет; `value` — значение по умолчанию; `type` — `length`/`angle`/`number`/`any`) |
| `configure` | `values` `{"Size":"Large","Lid":true,"len":65}` — выбрать варианты входов (флажок — `true` / `false` или имя варианта; переменная — значение, `""` — по умолчанию) |

`regions`: `"auto"` (по умолчанию — все замкнутые области, кроме «островов» внутри отверстий),
`"all"` или список точек `[[x, y], …]` в координатах эскиза — берутся области, содержащие точки.

### Фигуры эскиза (`shapes`)

```jsonc
{"type":"rect", "x":0, "y":0, "w":40, "h":20}            // от угла (x, y)
{"type":"rect", "center":true, "x":0, "y":0, "w":"#w", "h":20}
{"type":"circle", "c":[0,0], "r":5}    // или "d"
{"type":"ellipse", "c":[0,0], "rx":"#a", "ry":8, "rotation":0}   // полуоси; строка → размер диаметра оси
{"type":"line", "from":[0,0], "to":[10,0]}
{"type":"polyline", "points":[[0,0],[60,0],[60,6],[6,6],[6,40],[0,40]], "closed":true}
{"type":"arc", "c":[0,0], "r":10, "start":0, "end":90}   // против часовой, градусы
{"type":"slot", "from":[0,0], "to":[30,0], "r":4}
{"type":"polygon", "c":[0,0], "r":10, "sides":6, "rotation":90}   // r — окружность через вершины, 3…50 сторон
{"type":"polygon", "c":[0,0], "r":"6.5 mm", "sides":6, "inscribed":true}   // окружность касается сторон: «под ключ» 13 мм
{"type":"text", "text":"WebCAD", "at":[0,0], "height":10, "font":"sansBold", "rotation":0}   // строка от начала базовой линии, height — высота прописных; шрифты sans (Inter), sansBold, mono (JetBrains Mono); буквы — области (regions "auto" — без внутренних просветов «О»)
{"type":"text", "text":"WebCAD", "at":[0,5], "width":"60 mm", "align":"center"}   // вместо height — ширина рамки (высота по шрифту; строка → размер нижней стороны рамки);
                                        // align: где at на базовой линии — left (начало, по умолчанию), center, right
{"type":"point", "at":[15,15]}          // для отверстий
{"type":"gear", "c":[0,0], "teeth":"#z", "outerDiameter":"#d"}   // шестерня: эвольвентные зубья — один зуб в круговом массиве;
                                        // размер — module / outerDiameter / pitchDiameter (одно), pressureAngle (20°), rotation,
                                        // backlash — люфт пары (каждый зуб тоньше на половину); "mesh":true — зацепление с
                                        // предыдущей шестернёй эскиза (поворот считается сам и следует за ней);
                                        // выражения остаются живыми: смена #z перестраивает зубья. Её область — шестерня
```

Пара шестерён для печати: `{"op":"sketch","name":"Pair","shapes":[{"type":"gear","teeth":12,"module":1,"backlash":0.2},`
`{"type":"gear","teeth":20,"module":1,"backlash":0.2,"c":[16,0],"mesh":true}]}` — межосевое (z₁ + z₂)·m / 2 = 16 мм,
зубья второй во впадинах первой; выдавливание даёт две детали с зазором 0,2 мм.

Шестерня целиком параметрическая: `[{"op":"variable","name":"z","value":12,"type":"number"},`
`{"op":"variable","name":"w","value":6},{"op":"sketch","name":"Gear","shapes":[{"type":"gear","teeth":"#z","outerDiameter":12}]},`
`{"op":"extrude","sketch":"Gear","depth":"#w"}]` — затем `{"op":"setVariable","name":"z","value":20}` даёт 20 зубьев того же
диаметра. Шестерня, которую нельзя построить (меньше 6 зубьев, заострённые зубья), — ошибка с причиной.

Любая фигура (кроме точки) принимает `"construction": true`. Координаты — числа или выражения.

### Плоскости и оси

- `PlaneSpec`: `"top"` | `"front"` | `"right"` | `{"plane":"Plane 1"}` | `{"mate":"MC1"}` (плоскость XY соединителя) |
  `{"face": FaceQuery}` (ровно одна плоская грань).
- `AxisSpec`: `"x"`, `"y"`, `"z"`, `"-x"`… (оси мира через начало координат) | `{"edge": EdgeQuery}` |
  `{"face": FaceQuery}` (ось цилиндра) | `{"sketch":"Sketch 2","line":0}` (n-я линия эскиза) | `{"mate":"MC1"}` (ось Z соединителя).

Mate connector — локальная система координат. Типичный приём: поставить соединитель на грань, построить
на нём эскиз и перенести деталь «от соединителя к соединителю»:

```json
[
  {"op":"mateConnector","name":"Top","at":{"face":{"normal":"z","pick":"+z"}},"offset":[10,0,0]},
  {"op":"sketch","name":"Boss","plane":{"mate":"Top"},"shapes":[{"type":"circle","d":8}]},
  {"op":"extrude","sketch":"Boss","depth":5,"boolean":"new"},
  {"op":"mateConnector","name":"Below","at":"origin","flip":true},
  {"op":"transform","parts":"Part 2","from":"Top","to":"Below"}
]
```

### Запросы граней, рёбер и деталей

Все координаты — в единицах документа. Запросы считаются по модели, построенной до фичи, которая
их использует. Если ничего не найдено — это ошибка (документ не меняется).

```jsonc
// FaceQuery
{"normal":"z", "pick":"+z"}            // верхняя плоская грань
{"type":"cylinder", "radius":5}
{"normal":"-y", "y":-15}               // фильтры по центру грани: x / y / z — число или [min, max]
{"near":[10,0,5]}                      // ближайшая к точке
{"part":"Part 2", "pick":"largest"}    // pick: largest | smallest | +x | -x | +y | -y | +z | -z
// EdgeQuery: x / y / z проверяются для ВСЕХ точек ребра (начало, середина, конец)
{"dir":"z"}                            // прямые рёбра, параллельные Z
{"z":10}                               // все рёбра в плоскости z = 10
{"type":"circle", "z":[0,10]}
{"onFace":{"normal":"z","pick":"+z"}}  // рёбра верхней грани
{"near":[0,0,10]}                      // одно ближайшее ребро
// PartQuery
"all" | "Part 1" | 0 | {"near":[x,y,z]}
```

`edges` / `faces` / `parts` принимают один запрос, массив запросов (объединение) или `"all"`.
Подобрать запрос помогает `npm run agent -- query '{"edges":{"z":10}}'` — он возвращает найденные
элементы с геометрией (тип, точки, радиус, длина, площадь).

`measure` с теми же запросами возвращает значения панели измерений в единицах документа (углы в градусах):
у одного элемента — его размеры (`Volume`, `Area`, `Length`, `Radius`…); у двух — `Minimum distance` (и `ΔX`…),
`Maximum distance`, `Center to center` (окружности, сферы, оси цилиндров), `Angle` (острый, между прямыми и
плоскостями); у нескольких — `Total length` / `Total area` / `Total volume`. Например:
`npm run agent -- measure '{"faces":[{"normal":"z","pick":"+z"},{"normal":"x","pick":"+x"}]}'`.

### Произвольные фичи: подстановки

В `params` операций `feature` и `set` объект с единственным ключом на `$` заменяется ссылками:

| Подстановка | Результат |
| --- | --- |
| `{"$faces": Faces}` / `{"$edges": Edges}` / `{"$parts": Parts}` | список ссылок |
| `{"$regions": {"sketch":"Sketch 1","regions":"auto"}}` | области эскиза |
| `{"$plane": PlaneSpec}` / `{"$axis": AxisSpec}` | `[ссылка]` |
| `{"$sketchPoints": "Sketch 3"}` / `{"$sketchCurves": "Sketch 3"}` | точки / кривые эскиза |
| `{"$feature": "Extrude 1"}` / `{"$features": [...]}` | id фич |

Например, вытягивание по траектории:

```json
{"op":"feature","type":"sweep","params":{
  "profiles":{"$regions":{"sketch":"Profile"}},
  "path":{"$sketchCurves":"Path"}}}
```

Имена параметров — как в `src/core/types.ts` (`ExtrudeParams`, `SweepParams`…); значения-выражения — строки.

## Сборки

Один список операций может построить детали в Part Studio, а затем собрать из них сборку: операции
сборок работают с активной вкладкой сборки или с той, что открывает `assembly`; `studio` возвращает к
Part Studio. Всё по-прежнему применяется одним шагом отмены, при ошибке документ не меняется.

```json
[
  {"op":"sketch","shapes":[{"type":"rect","center":true,"w":40,"h":30}]},
  {"op":"extrude","depth":10},
  {"op":"sketch","shapes":[{"type":"circle","c":[60,0],"r":5}]},
  {"op":"extrude","depth":20,"boolean":"new"},
  {"op":"part","part":"Part 1","name":"Plate"},
  {"op":"part","part":"Part 2","name":"Pin"},
  {"op":"assembly","name":"Rig"},
  {"op":"insert","part":"Plate","fixed":true},
  {"op":"insert","part":"Pin"},
  {"op":"mate","type":"revolute",
   "a":{"instance":"Plate <1>","face":{"normal":"z","pick":"+z"}},
   "b":{"instance":"Pin <1>","edge":{"type":"circle","pick":"-z"}}}
]
```

| op | Поля |
| --- | --- |
| `assembly` | `name?` — открыть вкладку сборки с этим именем или создать её |
| `studio` | `name?` — открыть Part Studio с этим именем или создать её |
| `insert` | `part` (имя детали) и `studio?` (Part Studio, если деталь с таким именем есть в нескольких) — или `assembly` (вставить сборку как подсборку); `name?` (по умолчанию «Pin <1>»), `position?` `[x, y, z]`, `rotation?` `[rx, ry, rz]` (градусы вокруг X, затем Y, затем Z), `fixed?`, `flexible?` (подсборка гибкая: её детали движутся по её сопряжениям), `configuration?` `{"Size":"Large","len":500}` — свой вариант конфигурации Part Studio (у входа-переменной — значение; входы, которых нет, — как выбрано в Part Studio) |
| `place` | `instance`, `position?`, `rotation?`, `fixed?`, `hidden?`, `name?`, `flexible?` (только подсборка; `false` — снова жёсткая, детали возвращаются на места), `configuration?` (дополняет вариант экземпляра; `{}` — снова как в Part Studio) |
| `mate` | `type` (`fastened` / `revolute` / `slider` / `cylindrical` / `planar` / `ball` / `parallel` / `pinSlot` / `tangent` / `width`), `a`, `b` — концы (`MateEnd`), `a2?` / `b2?` (вторые грани пар у `width`; у `pinSlot` `a2` — ребро вдоль паза), `name?`, `flip?` (по умолчанию — ближайший к текущему положению), `angle?`, `offset?`, `limits?` `{zMin, zMax, aMin, aMax}` |
| `group` | `instances` (имена), `name?` |
| `relation` | `type` (`gear` / `rackPinion` / `screw`), `a`, `b?` (имена сопряжений), `value` (передаточное число; делительный диаметр или шаг — длина), `reverse?`, `name?` |
| `deleteInstance` | `instance` (с его сопряжениями и связями) |
| `deleteMate` | `mate` |
| `explodedView` | `name?` (по умолчанию «Exploded view N»; вид с этим именем заменяется), `steps` — шаги по порядку: `{instances, dir, distance?, angle?, pivot?}` — экземпляры (имена) сдвигаются на `distance` (единицы документа) по `dir` (`"+z"`, `"-x"`… или вектор `[x, y, z]`) и / или поворачиваются на `angle` градусов вокруг `dir` через `pivot` `[x, y, z]` (по умолчанию — центр их габарита там, где их оставили предыдущие шаги); `add?` — шаги добавляются к шагам вида. Разнесённый вид только показывает сборку разнесённой: положения экземпляров не меняются |
| `deleteExplodedView` | `name` |

Разнесённые виды попадают в отчёт: `"explodedViews":[{"name":"Apart","steps":2,"moved":[{"name":"Pin <1>","bboxMin":[…],"bboxMax":[…]}]}]`
— габариты сдвинутых экземпляров в полностью разнесённом виде. Снимок разнесённого вида:
`npm run agent -- shot apart.png iso --exploded "Apart"` (`--amount 0.5` — наполовину).

**Анимация** сопряжения (Onshape Animate) — запрос, документ не меняется: `animate` проводит свободное движение
сопряжения (`revolute`, `pinSlot` — поворот, `slider` — сдвиг, `cylindrical` — оба) от `from` до `to` и
возвращает, где по кадрам стоят экземпляры, которые движутся:

```jsonc
// npm run agent -- animate '{"mate":"Slider 1","from":0,"to":30,"frames":4}'
{"mate":"Slider 1","motion":"slide",
 "frames":[{"value":0,"instances":[{"name":"Pin <2>","position":[…],"rotation":[…],"bboxMin":[…],"bboxMax":[…]}]}, …]}
```

Поля: `mate`, `motion?` (`turn` — градусы, `slide` — единицы документа вдоль оси Z сопряжения; по умолчанию
первое движение сопряжения), `from?` / `to?` (по умолчанию — пределы сопряжения, иначе от текущего положения
полный оборот / 20 мм), `frames?` (2…50, по умолчанию 5, концы включены), `assembly?` (имя сборки; по умолчанию
открытая). Так удобно проверять, не задевают ли детали друг друга по ходу движения (`bboxMin` / `bboxMax`).

`MateEnd` — где сопряжение крепится к экземпляру:

```jsonc
{"instance":"Pin <1>", "face":{"type":"cylinder"}}          // грань: FaceQuery в координатах сборки, только по этому экземпляру
{"instance":"Pin <1>", "edge":{"type":"circle","pick":"-z"}} // ребро: EdgeQuery
{"instance":"Pin <1>", "vertex":[0,0,30]}                    // ближайшая вершина
{"instance":"Pin <1>", "connector":"Top"}                    // соединитель его Part Studio (владелец — эта деталь)
{"instance":"Sub <1>/Pin <1>", "face":{…}}                   // деталь внутри подсборки
```

Запрос должен найти ровно одну грань или ребро — иначе ошибка с подсказкой добавить `pick`, `near` или
координаты. После каждого `mate` сборка решается, так что следующие запросы видят детали уже на местах.
Положения в `insert` / `place` — в единицах документа; если сопряжения не дают экземпляру встать туда,
побеждают сопряжения (свободные степени свободы берут заданные значения).

Отчёт операций сборки вместо `model` содержит `assembly`:

```jsonc
"assembly": {
  "name": "Rig",
  "instances": [{"name":"Pin <1>","source":"Part Studio 1","position":[0,0,10],"rotation":[0,0,0],
                 "bboxMin":[-5,-5,10],"bboxMax":[5,5,30]}],      // у гибкой подсборки ещё "flexible":true
  "mates": [{"name":"Revolute 1","type":"revolute","a":"Plate <1>","b":"Pin <1>","ok":true}],
  "groups": [], "relations": []
}
```

Невыполнимые сопряжения попадают в `failed` (и `ok: false`) — в том числе сопряжения гибких подсборок, с именем
вида «Slider <1> / Planar 1». `state` на вкладке сборки возвращает
`{assembly}`, `export step` — сборку с деревом изделия, `export stl` — все её детали одной сеткой.

## Отчёт

`run` и `state` возвращают:

```jsonc
{
  "ok": true, "applied": true,
  "added": ["Sketch 1", "Extrude 1"], "changed": [], "removed": [],
  "failed": [],                          // [{feature, error}] — ошибки ядра
  "error": "op #3 (fillet): No edge matches {…}",   // при ошибке разбора, ничего не применено
  "model": {
    "features": [{"name":"Extrude 1","type":"extrude","status":"ok"}],
    "variables": {"w":"40 mm"},
    "parts": [{"id":"…","name":"Part 1","bboxMin":[-20,-15,0],"bboxMax":[20,15,10],
               "size":[40,30,10],"volume":11214.6,"area":3260.1,"faces":10,"edges":24}],
    "sketches": [{"name":"Sketch 1","origin":[0,0,0],"xDir":[1,0,0],"yDir":[0,1,0],"normal":[0,0,1],"regions":2}],
    "mates": [{"name":"Top","origin":[10,0,10],"xDir":[1,0,0],"zDir":[0,0,1],"owner":"Part 1"}]
  }
}
```

Проверяйте результат по `size` / `volume` и скриншоту (`shot`), а не только по `ok`.

## `window.webcad`

Те же методы доступны на странице: `documents()`, `open(idOrName)`, `create(name)`, `state()`,
`run(ops, {atomic})`, `query(q)`, `measure(q)`, `animate(q)`, `feature(name)`, `undo()`, `redo()`, `cancelEdit()`,
`view(name)`, `section({plane, offset?, flip?} | null)` (сечение по top / front / right),
`screenshot({view, exploded?, amount?})` (PNG data URL; `exploded` — разнесённый вид открытой сборки по имени),
`export(format)` (`{fileName, mime, base64}`), `help()`.
Из CLI: `npm run agent -- call section '{"plane":"front","offset":5}'`.

Если в приложении открыт диалог фичи или эскиз, изменения отклоняются: завершите правку или
вызовите `cancelEdit()`.

## Устройство

- `src/agent/types.ts` — типы операций и отчёта, `src/agent/runner.ts` — разбор операций и запросов,
  `src/agent/assembly.ts` — операции сборок, `src/agent/document.ts` — список операций по вкладкам,
  `src/agent/browser.ts` — `window.webcad` и клиент моста, `src/agent/headless.ts` — Node.
- Мост — плагин в `vite.config.ts` (`/__webcad/rpc|poll|reply|status`, только POST с заголовком
  `x-webcad`, запросы с других сайтов отклоняются). Работает в `npm run dev` и `npm run serve`;
  в статическом хостинге моста нет, `window.webcad` при этом доступен.
- Тесты: `src/agent/agent.test.ts` (реальное ядро OpenCascade в Node).
