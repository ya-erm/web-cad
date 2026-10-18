# Onshape: функциональный справочник для офлайн-клона

Выжимка из официальной справки Onshape (cad.onshape.com/help, FeatureScript docs) по состоянию на 2026-10. Названия инструментов и пунктов UI оставлены на английском, как в Onshape.
Пометка **(не подтверждено)** означает, что факт не найден в документации: он взят из форума или по памяти, либо выведен логически.

---

## 1. Part Studio: раскладка UI

### 1.1 Общая структура окна
| Зона | Содержимое |
|---|---|
| Верх | Document toolbar (меню документа, имя, справка «?» справа с пунктом Keyboard shortcuts). Ниже контекстный тулбар: **Feature** в Part Studio, **Sketch** в открытом скетче, **Assembly**, **Drawing**. |
| Слева | Панель **Features list**: счётчик фич и строка поиска сверху, затем **Default geometry**, фичи, **Rollback bar**, разделитель и **Parts list**. |
| Центр | Graphics area: светлый фон, Origin и три плоскости. |
| Правый верхний угол | **View cube** со стрелками и выпадающим меню вида. |
| Правый нижний угол | Иконки **Measure** (`[`), **Mass properties** (иконка весов) и Analysis tools. |
| Низ | Tab bar: вкладки Part Studio, Assembly, Drawing, импортированных файлов и т.д. Кнопка **+** («Insert new element») создаёт Part Studio, Assembly, Drawing, Feature Studio или папку. Слева Tab manager (`Alt+T`). |
| Тема | Светлая или тёмная (настройка аккаунта). |

Правила тулбаров:
- Группы инструментов разделены вертикальными линиями. Стрелка ▾ рядом с иконкой открывает выпадающий список группы.
- Иконка группы показывает последний использованный инструмент. Последний использованный инструмент поднимается наверх своей группы, при повторном открытии документа порядок сбрасывается.
- ПКМ по тулбару открывает **Customize toolbar…** (перетаскивание наборов, Reset to default).
- Search tools: `Alt/⌥+C`.
- Shortcut toolbar `S` у курсора: в открытом скетче появляется Sketch-набор, иначе Features-набор.

### 1.2 Порядок Feature toolbar
Документация показывает тулбар только картинкой. Порядок ниже взят из Icon Glossary, который совпадает с порядком тулбара. Группировка частично подтверждена: Enclose находится в дропдауне Thicken, а мобильные категории подтверждают группы Extrude / Fillet / Linear pattern / Boolean / Modify fillet / Plane. Остальное **(не подтверждено)**.

| # | Группа | Инструменты (▾ = в дропдауне) |
|---|---|---|
| 0 | Sketch | **Sketch** (`Shift+S`) |
| 1 | Создание тел | Extrude (`Shift+E`), Revolve (`Shift+W`), Sweep, Loft, Thicken ▾ Enclose |
| 2 | Обработка | Fillet (`Shift+F`) ▾ Face blend, Chamfer, Draft ▾ Body draft, Rib, Shell, Hole, External thread |
| 3 | Массивы | Linear pattern ▾ Circular pattern ▾ Curve pattern; Mirror |
| 4 | Тела | Boolean, Split, Transform, Wrap, Decal, Delete part |
| 5 | Direct edit | Modify fillet ▾ Delete face ▾ Move face ▾ Replace face |
| 6 | Плоскости и поверхности | Plane; Offset surface, Boundary surface, Fill, Move boundary, Ruled surface, Mutual trim, Constrained surface |
| 7 | Кривые | Helix, 3D fit spline, Projected curve, Bridging curve, Composite curve, Intersection curve, Trim curve, Isocline, Offset curve, Isoparametric curve, Edit curve, Routing curve |
| 8 | Прочее | Mate connector (`Ctrl+M`), Derived, Variable, Query variable, Composite part, Tag |
| 9 | Frames / Sheet metal / PCB | Frame, Frame trim, Gusset, End cap, Cut list; Sheet metal model, Flange, Hem, Tab, Bend, Form, …, Finish sheet metal model |

Для MVP клона достаточно групп 0–6, а из группы 7 нужен только Helix.

### 1.3 Features list
- Сверху вниз: (Configurations), **«N features»** и поле поиска, затем сворачиваемая группа **Default geometry** с элементами **Origin, Top, Front, Right**. Далее фичи в порядке истории, **Rollback bar** и Parts list.
- Default geometry можно скрыть (иконка «глаз» при hover, `P` скрывает плоскости), но нельзя удалить. Ориентацию дефолтных плоскостей менять нельзя.
- Плоскость можно выделить и изменить её размер ручками. Пункт ПКМ **Size to Part Studio** подгоняет размер под все детали.
- Имена фич: «Sketch 1», «Extrude 1» и т.д. **(не подтверждено, общеизвестно)**.
- Индикаторы:
  - зачёркнутое имя у подавленной фичи;
  - синий индикатор у недоопределённого скетча;
  - жёлтый треугольник у фичи с потерянными ссылками;
  - красный у ошибки, заголовок диалога ошибочной фичи тоже красный.
- Фичи можно перетаскивать для изменения порядка (это параметрическая операция). Поддерживаются папки: **Add selection to folder…** и **Unpack folder**.
- Поисковые фильтры: `:part`, `:errors`, `:warnings`, `:suppressed`, `:hidden`, `:shown`, `:name`, `:type`.

**Rollback bar**
- Перетаскивается мышью. Всё ниже бара временно подавлено, при этом можно добавлять и редактировать фичи в откатанном состоянии.
- ПКМ по фиче → **Roll to here**, ПКМ по бару → **Roll to end**.
- Если бар выделен, `↑`/`↓` двигают его на одну фичу.

**Контекстное меню фичи (Features list)**: Edit, Rename (`Shift+N`), Suppress / Unsuppress, Dynamic suppression, Hide/Show, Show dependencies, Expand/Collapse (selected/all), Add selection to folder…, Roll to here, Delete, Add comment, Copy (`Ctrl+C`/`Ctrl+V` для фичи).
Только для скетча дополнительно: Copy sketch, Show dimensions, Create Drawing of Sketch, Export as DXF/DWG, Zoom to selection, View normal to, Clear selection.
Двойной клик открывает фичу на редактирование **(не подтверждено)**.

**Диалог фичи**
- Зелёная галка или `Enter` принимает, красный X или `Esc` отменяет. `Shift+Enter` принимает и сразу открывает тот же инструмент снова.
- Ползунок **Preview** задаёт прозрачность от 0% (до фичи) до 100%.
- Кнопка **Final** при редактировании не последней фичи показывает итоговую модель.
- Типы полей: сплошное синее поле ждёт выбора в графике, синяя рамка ждёт ввода с клавиатуры.
- `Tab` переходит между полями, `Space` переключает чекбокс.
- Красный заголовок значит, что фичу нельзя принять, чёрный значит, что можно.

### 1.4 Parts list
- Под Rollback bar расположены сворачиваемые секции **Parts**, **Surfaces** (и meshes), **Composite parts**, **Curves**. У каждого заголовка есть «глаз» для скрытия всех элементов.
- Контекстное меню детали: Rename, Properties, Assign material, Edit appearance (цвет), Make transparent, Copy, Create drawing, Export, Release…, Hide / Hide other / Hide all, Show center of mass, Isolate, Add comment, Zoom to selection, Delete.
- Цвета деталей назначаются по палитре по порядку. После удаления детали цвета остальных пересчитываются, если не заданы вручную. Конкретная палитра **(не подтверждено)**.

### 1.5 Graphics area
- Контекстное меню пустого места: Show all, Show all parts, Create selection, Zoom to fit, Isometric, Clear selection. На плоскости дополнительно New sketch, Offset plane, View normal to. На детали: Hide (`Y`), Hide other, Isolate (`Shift+I`), Make transparent (`Shift+T`), Edit appearance, Export as DXF/DWG для плоской грани.
- Выделение:
  - клик переключает выделение (toggle), модификаторы не нужны; `Shift+клик` выделяет диапазон в списке;
  - `Space` или клик в пустоту снимает выделение;
  - `` ` `` открывает «Select other» под курсором;
  - `Alt+клик` выделяет сквозь прозрачные объекты.
- Box select:
  - слева направо: **window**, выбираются только целиком попавшие объекты, рамка сплошная синяя;
  - справа налево: **crossing**, выбирается всё, чего касается рамка, рамка пунктирная жёлтая;
  - `Ctrl+drag` снимает выделение.
- При hover подсвечиваются грани, рёбра, регионы и кривые, у рёбер и линий показываются midpoints.

### 1.6 Ориентация плоскостей и осей
| Плоскость | Положение | Нормаль | Ось X скетча → мир | Ось Y скетча → мир |
|---|---|---|---|---|
| **Top** | Z = 0 (XY) | **+Z** | +X | +Y |
| **Front** | Y = 0 (XZ) | **−Y** (по словам модератора на форуме) | +X | +Z |
| **Right** | X = 0 (YZ) | **+X** | +Y | +Z |

- Мир Z-up, правая система координат.
- Origin расположен в (0,0,0). Начало координат скетча является проекцией мирового origin на плоскость скетча (FS docs).
- Оси скетча для Front и Right выведены из нормали и правила правой руки **(не подтверждено)**.
- Front view (`Shift+1`) смотрит на плоскость Front, то есть из −Y в сторону +Y, Z направлена вверх **(не подтверждено точно)**.
- FeatureScript-константы `XY_PLANE` (normal Z, x X), `YZ_PLANE` (normal X, x Y) и `XZ_PLANE` (normal Y, x Z) — это абстрактные мировые плоскости, а не дефолтные плоскости Part Studio.
- Цвета плоскостей, Origin и фона **(не подтверждено)**. Ориентир: полупрозрачные плоскости с рамкой, подписи Top/Front/Right.
- Единицы документа по умолчанию — **Inch** (на странице Part Studios сказано «Default is Inch»), меняются в настройках документа или Workspace units.

---

## 2. Sketch tools

Скетч создаётся так: **Sketch** (`Shift+S`), затем выбор плоскости, плоской грани или Mate connector.
- Поля диалога Sketch: Sketch plane, **Disable imprinting** (грань не режется на регионы), **Show constraints**, Show expressions.
- Выход: зелёная галка. Если вызвать Extrude или Revolve с Sketch toolbar, скетч автоматически принимается и все регионы сразу выбираются.
- `Shift+H` скрывает и показывает все скетчи.
- Опция «Orient normal to sketch on edit» в меню вида включает автоматический поворот к скетчу.

| Инструмент | Клавиша | Поведение |
|---|---|---|
| **Line** | `L` | Клик-клик даёт цепочку соединённых сегментов, click-drag-release даёт один сегмент. `Esc` завершает. Сразу после создания можно набрать длину и `Enter` (или `=#var`). `Shift+A` переключает Line ↔ Tangent arc, также переключение происходит при наведении на конец линии. |
| Midpoint line | — | Линия строится симметрично от середины. |
| **Corner rectangle** | `G` | Два противоположных угла, стороны параллельны осям скетча. |
| **Center point rectangle** | `R` | Центр, затем угол. |
| Aligned rectangle | — | Три клика: базовая сторона под углом и перпендикулярная ширина. |
| **Center point circle** | `C` | Центр, затем точка на окружности. Сразу после можно ввести диаметр. |
| 3 point circle | — | Три точки на окружности. |
| **3 point arc** | `A` | Начало, конец, третий клик задаёт радиус (можно drag). Вводится значение радиуса. Подсказка для полуокружности. |
| Tangent arc | (`Shift+A` из Line) | Дуга, касательная в конце линии или дуги. После неё инструмент возвращается к Line. |
| Center point arc | — | Центр, старт (задаёт радиус), конец. |
| Ellipse | — | Центр, затем две полуоси. Большой будет та, что нарисована длиннее. Вводятся два диаметра. Также есть Elliptical arc и Conic (rho). |
| Inscribed / Circumscribed polygon | — | Центр и точка, вспомогательная окружность строится как construction. После второго клика число сторон вводится с клавиатуры или задаётся перетаскиванием: от 3 до 50, к центру меньше, от центра больше. По умолчанию 6 **(не подтверждено)**. Inscribed задаёт размер «по плоскостям», Circumscribed — «по вершинам». |
| **Spline** | — | Клики добавляют точки, двойной клик или ПКМ → Confirm spline завершают. Замыкание кликом в первую точку. Точки и белые tangent handles можно тянуть. Также есть Bezier и Spline control point. |
| **Point** | `Shift+S` (в скетче) | Точка скетча. |
| Text | — | Текст в рамке. |
| **Use** (project/convert) | `U` | Проецирует рёбра, силуэтные рёбра и рёбра других скетчей на плоскость. Результат ассоциативен и обновляется при изменении источника. Связь с внешней геометрией обозначается ограничением Use. |
| Intersection | — | Сечение граней или поверхностей плоскостью скетча (ограничения Intersection и Pierce). |
| **Construction** | `Q` | Переключатель: новые объекты рисуются как construction, либо выделенные объекты конвертируются. Отображаются пунктиром **(не подтверждено)**. Не образуют регионов. |
| **Fillet** (sketch) | `Shift+F` | Выбрать вершину или две кривые, потянуть и ввести радиус. Следующие клики по вершинам делают скругления того же радиуса, связанные одним размером. Остаётся «virtual sharp» (точка-фантом угла). Слишком большой радиус подсвечивается красным. Радиус по умолчанию 5 мм (по сообщениям форума). |
| Chamfer (sketch) | — | Фаска угла. |
| **Trim** | `M` | Клик по сегменту удаляет его до ближайших пересечений, без пересечений удаляется вся кривая. Drag через несколько кривых обрезает все задетые. |
| **Extend** | `X` | Удлиняет линию или дугу до ближайшего пересечения. Если пересечения нет, конец ставится в точку отпускания. |
| Split | — | Разбить кривую в точках. |
| **Offset** | `O` | Выбрать кривые или цепочку, тянуть стрелку или ввести расстояние, `Enter`. Отрицательное значение переворачивает сторону. Последующие клики используют то же расстояние. |
| Slot | — | Строится вокруг выбранных кривых (линия, дуга, сплайн, цепочка, замкнутый контур). Ширина управляется одним размером-диаметром, общим для всех слотов операции. |
| **Mirror** (sketch) | — | Сначала ось (линия скетча, плоскость, ребро), затем объекты, которые зеркалятся сразу. `Esc` завершает. Предвыбор тоже работает. |
| Linear / Circular pattern (sketch) | — | Массивы внутри скетча. |
| Transform (sketch) | — | Перемещение, поворот, масштаб манипулятором. |
| Insert DXF/DWG, Insert image | — | Импорт в скетч. |
| **Dimension** | `D` | См. §3.3. |

Дополнительно:
- `Shift` при перемещении или рисовании подавляет автоинференсы.
- `S` открывает shortcut toolbar скетча.
- `Esc` выходит из инструмента.
- `Alt+стрелки` переключают поля ввода размеров (например, ширина и высота прямоугольника).
- При рисовании курсор «прилипает» к инференсам: рядом с курсором появляются иконки ограничений (coincident, horizontal, vertical, tangent, midpoint и т.д.). Одновременно «просыпаются» вершины и рёбра существующей геометрии в плоскости скетча.

**Регионы.** Region — конечная область, ограниченная кривыми скетча (кроме construction). В скетче регионы закрашены и подсвечиваются при hover. Extrude, Revolve, Sweep и Loft выбирают именно регионы. Пересекающиеся контуры делятся на отдельные регионы. В режиме Solid Extrude автоматически выбирает замкнутые регионы и вложенные в них области. Цвет заливки **(не подтверждено)**: светло-серый или голубой, полупрозрачный.

---

## 3. Sketch constraints и размеры

### 3.1 Ограничения
| Constraint | Клавиша | Суть |
|---|---|---|
| Coincident | `I` | Совмещает точки, точку с кривой (с бесконечным продолжением) или кривую с плоскостью. |
| Concentric | `Shift+O` | Общий центр у дуг и окружностей, либо точка в центре. |
| Parallel | `B` | Две и более линии параллельны. |
| Tangent | `T` | Касание двух кривых или кривой и плоскости. |
| Horizontal | `H` | Линии или пары точек горизонтальны. |
| Vertical | `V` | Линии или пары точек вертикальны. |
| Perpendicular | `Shift+L` | Две линии перпендикулярны. |
| Equal | `E` | Равные длины линий или радиусы дуг и окружностей. |
| Midpoint | `Shift+M` | Точка в середине линии или дуги. |
| Normal | `Shift+K` | Кривая перпендикулярна линии или плоскости. |
| Pierce | `Shift+G` | Точка или кривая совпадает с точкой пересечения внешнего ребра с плоскостью скетча. |
| Symmetric | `Shift+Q` | Два однотипных объекта симметричны относительно линии, плоскости или ребра. |
| Fix | `Shift+J` | Фиксирует объект на месте. |
| Curvature | `Shift+U` | G2-переход для сплайнов и коник. |
| *Автоматические* | — | Quadrant (эллипс), Use (связь с внешней геометрией), Intersection. |

- Применение: выделить объекты и нажать инструмент, либо сначала инструмент, потом объекты. В режиме инструмента каждая пара выбранных объектов получает ограничение.
- Иконки ограничений показываются у объекта под курсором. `Shift` при движении мыши показывает все, чекбокс **Show constraints** показывает их постоянно.
- Удаление: клик по иконке и `Delete`. Есть также Constraint manager.
- Цвет иконки:
  - чёрная на сером — ограничение в порядке;
  - белая иконка — ограничение внутри скетча, синяя — ссылка на внешнюю геометрию (origin, рёбра);
  - белая на красном — конфликт.

### 3.2 Состояние определённости (цвета)
| Цвет геометрии | Состояние |
|---|---|
| **Синий** | Under-defined (недоопределён, можно тянуть мышью). |
| **Чёрный** | Fully defined. |
| **Красный** | Over-defined или конфликт ограничений. |

- При выборе перекрывающихся точек приоритет у недоопределённых (синих и красных) перед чёрными.
- Недоопределённый скетч помечается синим индикатором в Features list.
- Лишний размер, переопределяющий скетч, автоматически становится **driven**.

### 3.3 Размеры (Dimension, `D`)
Тип размера определяется тем, что выбрано, и тем, куда тянется подпись:

| Выбор | Результат |
|---|---|
| Одна линия | Длина. Тяга вверх/вниз или влево/вправо даёт горизонтальную или вертикальную проекцию, тяга под углом даёт истинную длину. |
| Две точки | Тяга по оси даёт linear (H/V), под углом — direct (кратчайшее) расстояние. |
| Две параллельные линии | Расстояние между ними (неявно задаёт параллельность). |
| Точка и линия | Расстояние до линии **(отдельно не описано, стандартно)**. |
| Точка и плоскость | Расстояние до плоскости, при изменении движется скетч, плоскость остаётся на месте. |
| Окружность | Диаметр. |
| Дуга | Радиус. Переключатель радиус/диаметр не описан. |
| Две линии | Угол. Квадрант угла выбирается тем, куда тянется подпись. |
| Две конечные точки и дуга | Длина дуги. |
| Кривая и construction-линия | Тяга через construction-линию превращает размер в centerline-размер (удвоенный, «диаметральный»). |

- Значения: числа, выражения, тригонометрия, единицы (`10 mm`, `1 in`), переменные. Ссылка на переменную вводится как `#name`, а во время рисования как `=#name`.
- Отрицательные значения допустимы для расстояний, углов и длин: они переворачивают сторону. Для радиуса и диаметра запрещены.
- Двойной клик по размеру открывает редактирование.
- Driving-размер чёрный и редактируемый. Driven (reference) светло-серый, режим меняется через ПКМ → Change to driving/driven.

---

## 4. 3D-фичи

Общие понятия:
- **Creation type**: Solid / Surface / Thin. Последний выбор запоминается.
- **Result** (boolean): **New / Add / Remove / Intersect**. Для Surface доступны только New и Add.
- **Merge scope**:
  - по умолчанию включено **Merge with all**, без него появляется поле выбора деталей;
  - если геометрия касается одной детали, та добавляется автоматически;
  - Add, Remove или Intersect с пустым scope дают ошибку;
  - у New merge scope нет;
  - поверхности сливаются только с поверхностями, детали — только с деталями.

### Extrude (`Shift+E`)
| Параметр | Значения |
|---|---|
| Выбор | Solid/Thin: регионы скетча и грани. Surface: кривые скетча. |
| End type | **Blind**, **Up to next**, **Up to face**, **Up to part**, **Up to vertex**, **Through all**. «Symmetric» — это чекбокс, доступный только для Blind и Through all. |
| Depth | По умолчанию **25 mm** (форум), в дюймовом документе 1 in **(не подтверждено)**. Есть manipulator-стрелка. |
| Opposite direction | Стрелка разворота. |
| Direction (опц.) | Своя ось направления: ребро, линия, Z мейт-коннектора. |
| Offset | Для Up to…: недоход до цели на заданное расстояние, Flip offset. |
| Starting offset (опц.) | Начало от смещения: Blind distance или Entity (грань, деталь, Mate connector). |
| Draft (опц.) | Угол в градусах, нейтральная плоскость = плоскость скетча, flip. |
| Second end position (опц.) | Вторая сторона со своим end type, глубиной и draft. |
| Thin | Mid plane → одна Thickness, иначе Thickness 1 и Thickness 2 плюс flip wall. |
| Ошибки | Up to next без геометрии на пути даёт ошибку. Профиль должен целиком «попадать» в цель. |

### Revolve (`Shift+W`)
- Ось: линия скетча, линейное ребро, круговое ребро или окружность, Mate connector.
- Типы:
  - **Full** (чекбокс, включён по умолчанию, 360°);
  - **Blind** (одно направление, Revolve angle, Opposite direction);
  - **Symmetric** (угол делится пополам на обе стороны);
  - **Second end position** (две стороны с независимыми углами, аналог «Two directions»);
  - Up to next / face / part / vertex с Offset.
- Остальное (Creation type, Result, Merge scope) как у Extrude.

### Sweep
- Profile: регионы или грани для solid, кривые для surface.
- Path: цепочка кривых или рёбер, Opposite direction.
- Profile control: None / Keep profile orientation / Lock profile faces / Lock profile direction.
- Опции: Twist (Turns, Angle или Pitch), Scale (коэффициент на конце). Для Thin есть Trim ends.

### Loft
- Profiles задаются по порядку (минимум 2, допускаются точки на концах), порядок можно менять.
- Start/End conditions: Normal to profile, Tangent to profile, Match tangent, Match curvature, Normal direction, Tangent direction (с Magnitude).
- Опции:
  - Guides and continuity;
  - Path с количеством сечений;
  - Match connections (автоматические связи вершин показываются **пурпурным**);
  - Show isocurves;
  - Trim profiles и guides (для Surface и Thin).

### Thicken
- Выбор: грани, поверхности, скетч.
- Mid plane → Thickness, иначе Thickness 1 и Thickness 2 плюс flip.
- Result New/Add/Remove/Intersect. При выборе грани детали Result автоматически ставится в Add.
- **Keep tools** по умолчанию выключен.

### Fillet (`Shift+F`)
| Параметр | Значения |
|---|---|
| Тип | **Edge** (рёбра или грани: грань скругляет все свои рёбра **(не подтверждено)**), **Full round** (между двумя противоположными гранями через среднюю). Face blend — отдельный инструмент. |
| Measurement | **Radius** или **Width** (хорда). |
| Cross section | **Circular**, **Conic** (Rho), **Curvature** (Magnitude 0…0.999). |
| Radius | Запоминается последнее значение. Стартовое значение ≈5 mm **(не подтверждено для 3D)**. |
| **Tangent propagation** | **Вкл. по умолчанию**, распространяет скругление на касательные рёбра. |
| Asymmetric | Second radius и flip. |
| Partial fillet | Начало и конец вдоль ребра. |
| Variable fillet | Значения в вершинах и добавленных точках, Smooth transition. |
| Allow edge overflow | Вкл. по умолчанию. |
| Smooth fillet corners | Опционально. |

### Chamfer
- Типы: **Equal distance**, **Two distances** (Flip direction), **Distance and angle** (угол по умолчанию **45°**, Flip).
- Measure from: Offset или Tangent.
- **Tangent propagation** включён (рекомендуется оставлять).
- Запоминаются последний тип и последняя дистанция.

### Draft
- Neutral plane: грани, нейтральная плоскость (грань или Mate connector), Angle (по умолчанию **(не подтверждено)**, есть оранжевая стрелка-манипулятор), Tangent propagation, Reverse.
- Parting line: parting edges, Pull direction, Sides (One sided / Symmetric / Two sided).
- Опция Reapply fillets.

### Shell
- Faces to remove, Thickness.
- Направление стенки задаётся стрелками: внутрь (по умолчанию) или наружу.
- **Hollow** (без удаления граней) по умолчанию выключен.

### Hole
- Style: **Simple / Counterbore / Countersink**.
- Standard: вкладки Inch / Metric.
- Hole type: Drilled / Clearance / Tapped / PEM.
- Start: from part (по умолчанию), sketch plane или selected plane.
- Termination: **Blind / Up to next / Up to entity / Through all**.
- Tip angle: **118°** / 135° / Flat / Custom (дефолт 118° **(не подтверждено)**).
- Параметры cbore и csink: диаметр, глубина, угол.
- Locations: точки скетча (все не-construction точки выбранного скетча) или Mate connectors.

### Rib
- Profiles (кривые скетча), Parts, Thickness.
- Направление: Normal to sketch plane или Parallel to sketch plane, flip.
- Опции: Extend profiles to part, Merge ribs, Draft.

### Patterns и Mirror
| Фича | Тип | Ключевые параметры |
|---|---|---|
| **Linear pattern** | Part / Feature / Face | Direction (ребро, линия, плоскость, MC), Distance (шаг), Instance count (включая исходный, минимум 1), Centered, Second direction, Skip instances, Reapply features (Feature, по умолчанию выкл.), Result, Merge scope. |
| **Circular pattern** | Part / Feature / Face | Axis, Angle, Instance count, **Equal spacing** (вкл.: экземпляры распределены по Angle; выкл.: Angle — шаг между соседними), Opposite direction, Centered, Skip. |
| **Curve pattern** | Part / Feature / Face | Path, Instance count, Equal spacing или Distance, Orientation (Tangent to curve / Normal to face / Locked). |
| **Mirror** | Part / Feature / Face | Mirror plane (плоскость, плоская грань, Top/Front/Right, MC), Result, Merge scope, Reapply features. |

Различие типов:
- **Part** копирует тела.
- **Feature** повторяет фичи из истории, результат сливается с телом.
- **Face** копирует грани на той же детали.

### Boolean
- Операции: **Union / Subtract / Intersect**.
- Tools обязательны. Targets нужны только для Subtract.
- **Keep tools** (последнее значение запоминается).
- Только для Subtract: Offset (Offset all или Faces to offset, distance).
- Тела должны пересекаться. Имя и атрибуты берутся у первого выбранного тела.

### Split
- **Part**: тела, инструмент (плоскость, поверхность, грань, MC; одна сущность).
- Опции: Keep tools (для грани по умолчанию вкл.), **Keep both sides**, иначе один бок с flip, Trim to face boundaries.
- **Face**: разбиение граней кривыми, плоскостями или поверхностями.

### Transform
- Типы:
  - **Translate by line** (по умолчанию: ребро или две точки);
  - **Translate by distance** (направление + distance);
  - **Translate by XYZ** (+ манипулятор);
  - **Transform by mate connectors**;
  - **Rotate** (ось + угол);
  - **Copy in place**;
  - **Scale uniformly** (коэффициент и точка; если снять галку, задаются X/Y/Z).
- Чекбокс **Copy part** делает копию вместо перемещения.

### Delete part
Параметрическая фича «Delete part»: деталь или поверхность исчезает из Parts list. Отличается от Delete по грани: тот удаляет фичу-создателя грани.

### Plane
| Тип | Вход | Параметры |
|---|---|---|
| **Offset** (дефолт при предвыборе грани) | плоскость, грань, MC | Distance, flip |
| Plane point | плоскость + точка | — |
| Line angle | линия + опорная плоскость, точка или ось | Angle |
| Point normal (дефолт при линии и точке) | ось или линия + точка | — |
| Three point | 3 точки | — |
| Mid plane | 2 плоскости | Flip alignment |
| Curve point | кривая + точка | — |
| Tangent | цилиндр + точка или плоскость | — |

Для всех типов есть **Flip normal**.

### Variable (`#name`)
- Типы: **Length / Angle / Number / Any**.
- Имя: латиница, цифры и `_`, чувствительно к регистру, не может начинаться с цифры.
- Значение — выражение с единицами (`2*#a + 5 mm`).
- Область видимости: переменная доступна только фичам **ниже** себя в Features list. Если создать переменную из диалога фичи, она вставляется перед этой фичей.
- Изменение значения обновляет всех потребителей, при переименовании есть «Update all references».
- Variable table на правой панели.

### Helix
- Источник: **Cylinder/Cone** (грань), **Axis** (линия, ребро или Z мейт-коннектора; Start radius и опциональный End radius), **Circle** (круговое ребро).
- Input type: Turns / Pitch / Turns and pitch.
- End: Height или End point.
- Start: Start angle или Start point.
- Направление: **Clockwise / Counterclockwise**, плюс Opposite direction.

### Mate connector (`Ctrl+M`, показать или скрыть: `K`)
- Origin type: **On entity** / **Between entities**. Origin entity: точка, грань (центроид) или другой MC.
- Realign: Primary axis (Z) и Secondary axis (X).
- Также Move X/Y/Z, Rotate, **Flip primary** (`A`), **Reorient secondary** (`Q`, поворот на 90°), Owner part.
- Ориентация по умолчанию:
  - на плоской грани — по грани;
  - на цилиндре и линии — по оси;
  - на конце кривой — по мировой Z.
- Implicit MC: при hover над гранью или ребром показываются точки-инференсы (центроид грани или профиля, середины, вершины, центры отверстий). `Shift` фиксирует текущую ссылку.

---

## 5. Клавиатура и мышь

### 5.1 Мышь (дефолтная схема Onshape, Win и Mac)
| Действие | Ввод |
|---|---|
| Выбор, box select | **ЛКМ** (клик или drag) |
| **Вращение (orbit)** | **ПКМ + drag** (Alt при вращении на Windows доводит до ближайшего вида без крена) |
| **Pan** | **СКМ + drag** или **Ctrl + ПКМ + drag** |
| **Zoom** | **Колесо**: вверх приближает, вниз отдаляет. Направление можно инвертировать в настройках. |
| Zoom to fit | **Двойной клик колесом** или `F` |
| Контекстное меню | ПКМ без перемещения, на Mac также `Ctrl/Cmd + ЛКМ` |

Остальное:
- В настройках можно выбрать схемы других CAD и constrained rotate.
- Zoom к курсору **(не подтверждено)**.
- Перспектива по умолчанию **выключена** (ортография).

### 5.2 View cube
- Клик по грани куба (Top / Bottom / Front / Back / Left / Right) даёт соответствующий вид.
- Клик по углу куба даёт **trimetric** вид. Клик по ребру **(не подтверждено)**.
- Стрелки вокруг куба поворачивают на 15°, с `Shift` на 90°, с `Ctrl` на 5°.
- Меню (▾):
  - Top, Bottom, Front, Back, Right, Left;
  - Isometric, Dimetric, Trimetric;
  - Named views, Previous view, Zoom to fit / window / selection;
  - Perspective (toggle), Orient normal to sketch on edit;
  - Shaded, Shaded without edges, Shaded with hidden edges, Hidden edges removed, Hidden edges visible, Translucent;
  - Tangent edges (visible / phantom / removed);
  - View in high quality, Section view.

### 5.3 Горячие клавиши: общие и вид (Part Studio)
| Клавиша | Действие |
|---|---|
| `Shift+1` … `Shift+7` | Front, Back, Left, Right, Top, Bottom, Isometric |
| `N` | View normal to (к выбранной или наведённой плоскости или грани). Повторное нажатие даёт вид с обратной стороны. |
| `F` | Zoom to fit |
| `W` | Zoom window (рамкой) |
| `Z` / `Shift+Z` | Zoom out / Zoom in |
| `←→↑↓` | Поворот на 15° |
| `Shift+стрелки` | Поворот на 90° |
| `Ctrl+стрелки` | Поворот на 5° |
| `Ctrl+Shift+стрелки` | Pan |
| `P` | Показать или скрыть плоскости |
| `Shift+P` | Скрыть всю construction-геометрию |
| `Shift+H` | Показать или скрыть скетчи |
| `Y` / `Shift+Y` | Скрыть деталь под курсором / показать скрытые |
| `Shift+I` | Isolate |
| `Shift+T` | Transparent |
| `Shift+X` | Section view |
| `Shift+V` | Named views |
| `Shift+R` | High-quality render |
| `K` | Показать или скрыть Mate connectors |
| `Shift+S` | **Sketch** (вне скетча) |
| `Shift+E` | **Extrude** |
| `Shift+W` | **Revolve** |
| `Shift+F` | **Fillet** (3D; в скетче это sketch fillet) |
| `Ctrl+M` | Mate connector |
| `[` | Measure |
| `Shift+C` | Curve/surface analysis |
| `Shift+D` | Dihedral analysis |
| `S` | Shortcut toolbar у курсора |
| `Alt+C` | Search tools |
| `Enter` / `Shift+Enter` / `Esc` | Принять / принять и повторить / отмена |
| `Space` | Снять выделение |
| `Delete` / `Backspace` | Удалить выбранные фичи |
| `Ctrl+Z` / `Ctrl+Y` (`⇧⌘Z`) | Undo / Redo (по пользователю, вкладке и сессии) |
| `Ctrl+C` / `Ctrl+V` | Копировать / вставить фичу |
| `Shift+N` | Переименовать выбранное |
| `` ` `` | Select other |
| `Shift+/` | Карта горячих клавиш |
| `Ctrl+Space` / `Alt+T` | Переключение вкладок / Tab manager |

Замечания по реализации:
- Shift+цифра привязана к физической клавише: набор `#` (это `Shift+3`) вне поля ввода переключает вид на Left. Поэтому в клоне хоткеи нужно матчить по `event.code`.
- Клавиши контекстные: в скетче `Shift+S` даёт Point, `H` — Horizontal, `M` — Trim. Полный список скетч-клавиш приведён в §2 и §3.

---

## 6. Measure и Mass properties

**Measure** (`[`, иконка в правом нижнем углу; значения показываются и без открытия панели при любом выделении):

| Выбор | Показывает |
|---|---|
| 1 ребро | Длина. Для дуги или окружности также радиус, диаметр и центр (X, Y, Z). |
| 2 вершины или точки | Координаты, center distance, min/max distance с ΔX/ΔY/ΔZ. |
| 1 грань | Площадь. |
| 2 грани | Параллельное расстояние, суммарная площадь, min/max. |
| 2 линии | Признак параллельности, параллельное, min и max расстояние, угол. |
| 3 и более | Min/max, суммарная площадь граней или суммарная длина рёбер. |

- При hover над значением в графике рисуется пунктир:
  - чёрный жирный — center, min или max расстояние;
  - **красный, зелёный, синий** — ΔX, ΔY, ΔZ;
  - тонкий — угол.
- Клик по значению копирует его. Повторный клик переключает полную точность и точность workspace.
- Иконка рядом со значением создаёт Variable из измерения.
- Единицы: cm, ft, in, m, mm, yd; градусы или радианы.

**Mass properties** (иконка весов справа внизу):
- Вкладка **Part**: Mass, Volume, Surface area, Center of mass, моменты инерции относительно ЦМ.
- Вкладка **Face**: Area, Perimeter, моменты инерции площади и полярные.
- Масса считается только для деталей с назначенным материалом, без материала масса 0 и деталь исключается.
- Свойства суммируются по выбранным деталям.
- Опционально: Mate connector как точка отсчёта, Override массы, «Show calculation variance».
- Центр масс показывается маркером, пока панель открыта.

---

## 7. Export

Как вызвать: ПКМ по детали в Parts list (или в графике) → **Export**, либо ПКМ по вкладке Part Studio → Export (вся студия).

| Поле | Значения и дефолт |
|---|---|
| File name | По умолчанию имя вкладки, при одной детали добавляется её имя. |
| Format (детали, студии) | **PARASOLID, ACIS, STEP, IGES, PVZ, JT, RHINO, GLTF, GLB, OBJ, 3MF, STL** (URDF только для сборок). |
| Export models oriented Y axis up | Чекбокс для любых форматов. |
| STEP | Preprocessing (None / Automatic / Remove small entities…), Use latest version (вкл.), **Use custom units** (cm, ft, in, m, mm). Без этой опции единицы — **метры**. Include derived tolerances (MBD). |
| IGES | Use compatibility mode. |
| Parasolid, Rhino | Version / Use latest version (вкл.). |
| **STL** | **Format: Text / Binary**. **Units: cm, ft, in, m, mm, yd**. **Resolution: Coarse / Medium / Fine / Custom**; для Custom задаются Chordal tolerance, Angular deviation, Minimum facet width. |
| OBJ, 3MF, GLTF, GLB | Resolution Coarse / Medium / Fine / Custom; для Custom задаются Distance tolerance, Angular tolerance, Max chord length. GLTF и GLB поддерживают Compress. OBJ выгружается zip-архивом (.obj и .mtl), всегда в метрах. |
| Export unique parts as individual files | По умолчанию выкл. (один файл), при включении получается zip. |
| Options | **Download**, Download and store in new tab, Store in new tab, Email link. |

- **Скетчи и плоские грани** экспортируются через ПКМ → **Export as DXF/DWG**. Настраиваются версия и единицы (скетч по умолчанию в единицах документа). Опции: «Set z-height to zero and normals to positive», «Export splines as polylines». Для грани выгружается только внешний контур, без размеров.
- Развёртка листового металла экспортируется в DXF или DWG.
- **Drawings** экспортируются в **PDF**, DWG, DXF, DWT, SVG, PNG, JPEG.
  - PDF: Color, Black & white или Grayscale; все или выбранные листы; текст Normal или Selectable.
  - DWG/DXF: Version, Units, способ экспорта текста.
- Экспорт не содержит истории фич.

---

## 8. Drawings (основы)

**Создание.** ПКМ по детали или вкладке → **Create drawing of …**.
- Шаблон выбирается фильтром Onshape, затем Standard (**ANSI** / **ISO** / JIS) и размер листа. ISO даёт проекцию первого угла и мм, ANSI — третьего угла.
- Custom template: Standard, язык, наличие титульного блока.
- Новый чертёж создаётся без видов, первый вид «висит» на курсоре: клик ставит его, `Esc` отменяет. «Suggested views» автоматически расставляет до 6 ортогональных видов.

**Виды**
- **Insert view**: ориентация Front (дефолт) / Top / Left / Right / Back / Bottom / Isometric или Named view, View scale, Simplification.
- **Projected** (`P`) включается автоматически после первого вида. Нужно тянуть от родителя в нужную сторону и кликнуть. Масштаб наследуется от родителя.
- **Section**: линия разреза Vertical, Horizontal или Angular, метки A…Y без I, O, Q, S, X, Z. Есть также Aligned section и Broken-out section.
- **Detail**: замкнутый контур (circle, rectangle, spline, polygon), свой масштаб и метка.
- **Auxiliary**: Normal, In line или Axis. Также Break, Crop, Flat pattern.
- View properties (двойной клик по виду): Tangent edges (Hidden / Solid / Phantom), поворот 0–360°, метки, Move to sheet.

**Аннотации**
- Dimension (`D`): 2 point linear, point-to-line, line-to-line, angular (по 2 линиям или по 3 точкам), **Radial** (`Shift+R`), **Diameter** (`Shift+D`), Ordinate, Chamfer, Max/Min (`Ctrl+M`), Foreshorten (`Shift+H`).
- Другие инструменты: Note (`N`), центровые линии и метки, GD&T, Datum, Hole callout, BOM и таблицы, Balloon.
- `Alt+drag` копирует аннотацию.

**Листы и титульный блок**
- Панель Sheets (`Ctrl+S`), навигация `PgUp` / `PgDn` / `Home` / `End`. Есть Create sheet и Duplicate.
- Титульный блок связан со свойствами: Part Number → DWG No, Description → Title, Revision → Rev. Номер листа и общее число листов обновляются автоматически.
- Размер листа меняется в Sheet properties, рамка и зоны при этом перестраиваются.
- `Ctrl+Q` обновляет виды после изменения модели.

**Экспорт**: ПКМ по вкладке → Export (PDF / DWG / DXF и др., см. §7).

---

## 9. Assemblies (кратко)

- Вкладка Assembly содержит **Instances list** (детали, подсборки, Mates, Groups, Mate connectors). Единственная default geometry сборки — Origin.
- **Insert** (`I`) вставляет детали или Part Studio из текущего документа или из версий других документов. Первую деталь обычно фиксируют (Fix) **(не подтверждено как обязательное)**.
- Mate создаётся так: выбрать тип, затем два Mate connector (явных или implicit по точкам-инференсам). Опции: Flip primary axis, Reorient secondary axis (90°), Offset, Limits. Animate, `Shift` фиксирует ссылку.
- Хоткеи сборки: `M` — mate (Fastened по умолчанию), `J` — показать или скрыть mates, `H` — Show mates mode, `Shift+S` — Snap mode, `S` — shortcut toolbar.

| Mate | DOF | Свобода (в системе первого MC) |
|---|---|---|
| **Fastened** | 0 | — (offset по X/Y/Z) |
| **Revolute** | 1 | Rz |
| **Slider** | 1 | Tz |
| **Cylindrical** | 2 | Tz, Rz |
| **Pin slot** | 2 | Rz, Tx |
| **Planar** | 3 | Tx, Ty, Rz |
| **Ball** | 3 | Rx, Ry, Rz |
| **Parallel** | 4 | Tx, Ty, Tz, Rz |
| Tangent, Width | — | Работают без MC (по граням). |

- Mate values (Limits, значения) доступны для всех типов, кроме Ball, Fastened, Tangent и Width.
- Relations: Gear (работает с Revolute, Cylindrical, Planar, Parallel), Rack and pinion, Screw, Linear **(список relations не подтверждён)**.
- Group фиксирует взаимное положение деталей без DOF.

---

## Источники
- Справка `cad.onshape.com/help/Content/`. Ключевые страницы: `Home/keyboard_shortcuts_and_hotkeys.htm`, `Home/glossary.htm`, `Home/icon_glossary.htm`, `PartStudio/features_and_parts_lists.htm`, `View/view_navigation_and_the_view_cube.htm`, `Sketch/working_with_constraints.htm`, `Sketch/dimension.htm`, `PartStudio/<feature>.htm` (extrude, revolve, fillet, chamfer…), `File/exporting_files.htm`, `Drawing/views.htm`, `Assembly/mates.htm`.
- FeatureScript Standard Library: `cad.onshape.com/FsDoc/library.html`.
- forum.onshape.com: ориентация плоскостей (обсуждения 6555 и 4608), значения по умолчанию (7856, 12501, 3912).
