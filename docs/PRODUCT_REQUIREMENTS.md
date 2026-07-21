# 3D Baduk 产品需求与技术复刻规范

> 文档版本：1.2
> 代码快照：`ab9a6d1` 及当前工作区中已实现的矩形棋盘、SGF、AI 自对弈、聊天、权威计时、观战分析和版本化发布等增量；最终测试与线上状态仍以第 20、21 节的实测证据为准
> 产品名称：**3D Baduk（奇异棋盘围棋）**
> 公开入口：<https://bamboo-baduk.pystashell.workers.dev/>（不代表当前工作区增量已部署）
> 目标读者：需要在不了解历史讨论的情况下，完整复刻本项目的产品、前端、规则引擎、AI、联机服务和部署流程的工程团队或 AI

## 0. 文档效力、状态和原则

本文是最终目标规格，不是只描述已发布版本的介绍页。除明确标为“兼容限制”或“后续项”的内容外，出现“必须”的条目都属于交付范围。文档快照时，最新增量已进入**当前工作区**，但仍须以本轮完整自动测试、浏览器回归和部署验证为准；公开入口可能仍是较早版本，只有完成第 21.4 节线上验证后才能声称同步。

状态说明：

- **公开基线**：已在此前公开版本中存在的行为，应保持兼容。
- **当前工作区实现**：矩形宽高、SGF、AI 对 AI、聊天、主时间/日式读秒、显式观战、本地 AI 局势分析、多候选变化图和版本化发布/回滚等最新功能已经落入本地代码；其最终测试与线上发布状态单独判断。
- **最终目标要求**：本文完整行为；即使当前实现已有对应代码，复刻者仍需通过浏览器和线上验收，不能把“本地测试通过”等同“已在线”。
- **兼容策略**：为读取旧正方形状态、旧房间或普通 SGF 所规定的确定行为。
- **代码推导规定**：原始讨论没有明确给出，但为避免实现分歧，根据当前代码确定的默认值或边界。

最高层原则：

1. 棋盘形状是**真实规则拓扑**，不是仅改变外观。邻接关系必须统一驱动数气、连通、提子、禁入点、超级劫、领地、点目、AI 合法性和坐标定位。
2. 一份逻辑棋局可以在不同视图间无损切换；视图不拥有棋局状态，也不能改变规则。
3. 联机棋局以服务端为唯一权威；AI 推理则完全在浏览器中完成。
4. 不得把特殊棋盘上的 KataGo 搜索估值宣传为官方胜率、精确目差或已标定的人类段位。
5. 所有外部输入都必须有结构、大小和频率边界；“聊天不审查文字”不等于取消 XSS 防护、身份校验或防刷屏。
6. 业务层只有一个 match session；`transport(local/online)` 与 `controllerByColor(human/ai)` 是正交轴，不能再复制成本地、AI、联机三套 UI、设置、规则或动作。

## 1. 产品定位

3D Baduk 是一个探索奇异曲面和周期边界的围棋 Web 游戏。核心体验是：玩家仍然在熟悉的正交交叉点上落子，但棋盘边缘按照竹筒、甜甜圈或莫比乌斯的方式连接，并可用平面展开、弧面或三维曲面观察同一盘棋。

### 1.1 目标用户

- 想和朋友在线体验非传统棋盘围棋的玩家。
- 想直观理解圆柱面、环面、莫比乌斯带拓扑的围棋或数学爱好者。
- 想与本地 KataGo 混合 AI 对弈、观看 AI 自对弈或复盘棋谱的用户。
- 想在平面判断全局、再切到三维观察曲面效果的用户。

### 1.2 核心用户旅程

1. 打开页面，默认看到 `19 × 19` 竹筒棋盘的 120° 弧面视图。
2. 选择拓扑、宽度、高度、计分规则和贴目，建立新棋盘。
3. 分别选择 transport 与 controller：local 可配置黑白为人类/AI 的全部组合；online 当前可建真人房，并由黑方房主在白席为空时接入 KataGo 白方。再选择计时并建立 session/房间，侧栏自动回到“棋局”。
4. 对局中通过 OGS 风格的侧栏标签在棋局、AI 分析、聊天、棋谱和设置间切换；棋盘始终占据主视觉区。
5. 随时切换可用视图、滑动展开面、旋转三维曲面、缩放和关闭音效，并从黑白时钟卡片看到当前用时。
6. 双方停着后标记死子并点目；联机时双方确认结果；时间耗尽则按超时终局。
7. 使用悔棋处理最近失误，必要时二次确认后认输；或进入完整复盘逐手播放、切换视图并查看多个 AI 候选及后续变化。
8. 导出 SGF，或导入 SGF 后以任意可用视图播放和 AI 分析；超时和认输结果分别兼容标准 `B+T/W+T` 与 `B+R/W+R`。
9. 联机时用 Unicode 文字、Emoji、表情包和可点击棋点坐标沟通，或选择“仅观战”进入房间并在自己的浏览器中做不影响棋手的局势分析。

### 1.3 明确不在当前范围

- 球面棋盘、正方体棋盘或任意曲面编辑器。
- 常规有四个角的平面棋盘作为新局形状选项。
- 账号体系、公开大厅、随机匹配、排行榜、等级分、支付或云端棋谱库。
- 让子、封盘和赛事裁判系统；基础主时间、日式读秒与认输已经在当前范围内。
- 对日本规则全部特殊判例的协会级实现；当前目标是可玩的核心规则闭环。
- 服务端 KataGo、第三方 AI API 或云 GPU 推理。
- 用户上传自定义图片表情包、图片聊天、语音聊天或端到端加密。
- 完整 SGF 棋谱树编辑器；当前导入以第一局的主分支为播放对象。

## 2. 名词和坐标约定

### 2.1 棋盘维度

- `width`：横向列数。
- `height`：纵向行数。
- `P = width × height`：不同逻辑棋点总数。
- `board[row][col]`：棋盘矩阵，外层必须恰有 `height` 行，每行必须恰有 `width` 列。
- 内部坐标以左上角为 `(row=0, col=0)`；`row` 向下增加，`col` 向右增加。

### 2.2 用户可见围棋坐标

- 列使用 `ABCDEFGHJKLMNOPQRSTUVWXYZ`，跳过字母 `I`。
- 行号从下向上递增，显示值为 `height - row`。
- 因此左下角是 `A1`，左上角是 `A{height}`。
- 最大宽度 25 时最后一列为 `Z`。
- 聊天坐标和界面坐标都使用这套规则。

### 2.3 SGF 坐标

SGF 坐标与界面坐标不得混用：

- SGF 点是两个字符，第一字符代表从左到右的列，第二字符代表从上到下的行。
- 按 FF[4] 使用 `a-zA-Z`，不跳过 `i`；本产品 25 以内的可玩棋盘只需小写字符。
- 例如内部 `(row=4, col=6)` 编码为 `ge`，与界面显示的围棋坐标不是同一个字符串。

## 3. 棋盘尺寸与新局配置

### 3.1 用户界面

必须提供三个正方形快捷项：

- `9 × 9`
- `13 × 13`
- `19 × 19`

必须另提供独立的宽度、高度数字输入：

| 字段 | 默认值 | 用户范围 | 步长 | 无效输入处理 |
| --- | ---: | ---: | ---: | --- |
| `width` | 19 | 5–25 | 1 | 四舍五入后夹到范围；空值回退 19 |
| `height` | 19 | 5–25 | 1 | 四舍五入后夹到范围；空值回退 19 |
| `komi` | 7.5 | 0–20 | 0.5 | 非有限值禁止；UI 空值回退 0 |

点击快捷项必须同时设置宽、高。修改任意一项后，快捷项只在宽高都等于该预设时保持选中。

### 3.2 产品默认值

用户第一次打开产品时必须采用：

~~~text
width = 19
height = 19
topology = cylinder（竹筒）
scoringRule = chinese（中国面积规则）
komi = 7.5
currentPlayer = black
view = arc
soundEnabled = true
AI model = b10
~~~

底层旧接口曾以 `19 / japanese / 6.5 / cylinder` 作为缺省值。它只作为未填写字段的旧协议回退，不得覆盖上述用户界面默认值。

### 3.3 建立新局

- 有棋局进度时，建立新局必须弹出确认，并显示目标拓扑、`width × height` 和“当前进度会被清除”。
- `transport=local` 时当前设备可直接建立新局；`transport=online` 时仅房主可以提交相同的新局动作（普通真人房的房主默认也是黑方，纯 AI 房主可不占颜色）。控制器是人类还是 AI 不产生第二套设置或新局流程。
- 变更顶部拓扑切换器与设置区拓扑按钮应同步；若已有进度，同样走新局确认流程。
- 新局清空棋子、提子数、死子、结果、停着数、悔棋、复盘事件和联机点目确认，黑方先行。

### 3.4 矩形兼容策略

`width` 和 `height` 是新状态的唯一权威字段：

- 新状态和协议快照**始终**写出 `width`、`height`。
- 仅当 `width === height` 时，额外写出弃用兼容别名 `size = width`。
- 矩形状态不得写出 `size`。
- 读取只含旧 `size=N` 的状态时迁移为 `width=N, height=N`。
- 同时出现三字段时，若不是 `size === width === height`，必须拒绝为歧义或损坏状态。
- 迁移不应改变棋子、行棋方、拓扑、超级劫历史、悔棋或复盘。

## 4. 三种规则拓扑

所有公式都以 `0 ≤ row < H`、`0 ≤ col < W` 为前提，其中 `W=width`、`H=height`，`mod` 必须返回非负余数。邻点结果必须去重。

### 4.1 竹筒 `cylinder`

左右周期连接，上下保留边界：

~~~text
left (r,c)  = (r, (c - 1) mod W)
right(r,c)  = (r, (c + 1) mod W)
up   (r,c)  = (r - 1, c)，仅 r > 0 时存在
down (r,c)  = (r + 1, c)，仅 r < H - 1 时存在
~~~

- 顶部和底部棋点各有 3 个不同邻点，中间行棋点各有 4 个。
- 没有传统平面棋盘的四个角；左、右可见边只是同一条接缝的两侧。
- 逻辑棋点数始终为 `W × H`，接缝不复制棋点。

### 4.2 甜甜圈 `torus`

左右和上下都周期连接：

~~~text
left (r,c) = (r, (c - 1) mod W)
right(r,c) = (r, (c + 1) mod W)
up   (r,c) = ((r - 1) mod H, c)
down (r,c) = ((r + 1) mod H, c)
~~~

- 在产品允许的最小尺寸 5 下，每个棋点也恰有 4 个不同邻点。
- 棋盘无边无角。
- 三维标准环面的内外圈格子视觉密度不同，但规则距离只由上述图邻接决定。

### 4.3 莫比乌斯 `mobius`

上下保留边界；左右接缝相连时反转行序：

~~~text
若 c > 0： left(r,c) = (r,c-1)
若 c = 0： left(r,0) = (H-1-r,W-1)

若 c < W-1： right(r,c) = (r,c+1)
若 c = W-1： right(r,W-1) = (H-1-r,0)

up/down 与竹筒相同，不跨上下边界。
~~~

也可用无限覆盖面定义。令覆盖列为 `k`：

~~~text
copy = floor(k / W)
canonicalCol = k mod W
canonicalRow = copy 为偶数 ? r : H - 1 - r
~~~

- 顶部和底部在物理上组成同一条边界圈；边界棋点 3 邻点，中间棋点 4 邻点。
- 没有四个传统角，但仍然不是无边界曲面。
- 在平面展开上移动一整个棋盘宽度后上下方向翻转，移动两个宽度后恢复。
- 反转使用 `height - 1 - row`，绝不能错误使用 `width`。

### 4.4 拓扑统一性验收

下列系统必须调用同一个权威 `neighbors(row,col)` 或等价纯函数，不得各自复制一份不一致公式：

- 棋块收集和气的去重；
- 提子、自杀、超级劫试走；
- 空区洪泛和领地归属；
- 整组死子切换；
- AI 特征、合法落点掩码和搜索试走；
- 平面/三维拾取到逻辑点的映射；
- 聊天坐标定位与复盘渲染。


## 5. 三维曲面参数化和视觉诚实性

三维模型的职责是把逻辑网格放到可观察曲面上；规则仍由拓扑图决定。

### 5.1 完整竹筒

可使用如下等价参数化：

~~~text
u = 2π × col / W
y = s × ((H - 1) / 2 - row)
P = (R sin u, y, R cos u)
~~~

列沿圆周，行沿轴向。第一列和最后一列之间画跨缝相邻关系，但不得重复第一列。

### 5.2 甜甜圈

标准环面：

~~~text
u = 2π × col / W
v = 2π × row / H
P = ((R + ρ cos v) cos u,
     (R + ρ cos v) sin u,
      ρ sin v)
~~~

其中 `R > ρ > 0`。必须说明：环面不能无失真地铺在普通三维空间里，内圈与外圈格子大小不同是嵌入造成的视觉失真，不影响逻辑规则。

### 5.3 莫比乌斯

使用：

~~~text
u = 2π × col / W
v = a × (1 - 2 × row / (H - 1))

P(u,v) = ((R + v cos(u/2)) sin u,
           v sin(u/2),
          (R + v cos(u/2)) cos u)
~~~

要求：

- `0 < a < R`，避免自相交。
- 满足 `P(u+2π,v)=P(u,-v)`。
- 曲面材质双面渲染；局部法线可以定义，但不得假设存在全局一致法线。
- 平滑表面可在几何接缝复制渲染顶点以保存 UV/法线反转，但逻辑棋点仍不得复制。

## 6. 视图与交互

### 6.1 可用视图矩阵

| 拓扑 | 平面展开 | 弧面 | 完整 3D | 初次选中该拓扑的推荐视图 |
| --- | --- | --- | --- | --- |
| 竹筒 | 是 | 是 | 是 | 弧面 |
| 甜甜圈 | 是 | 否 | 是 | 平面 |
| 莫比乌斯 | 是 | 否 | 是 | 平面 |

不适用的弧面按钮必须隐藏或禁用；从竹筒弧面切到其他拓扑时自动回退到平面。

### 6.2 平面展开

- 使用 Canvas 2D 或等价高性能实现，一次显示全局局势。
- 桌面端左键只负责落子，右键拖动负责浏览；触屏/触控笔仍使用轻点落子、单指拖动浏览。
- 竹筒：只允许横向周期拖动，改变切开棋盘的起点。
- 甜甜圈：允许上下、左右和斜向拖动，两个方向都周期循环。
- 莫比乌斯：横向拖动；越过奇数个棋盘宽度时行序和棋子方向翻转。
- 释放拖动后在约一个短动画内吸附到整格偏移，避免半格接缝难以阅读。
- 竹筒/莫比乌斯平面允许页面自身纵向滚动；甜甜圈棋盘区域需要拦截二维触控拖动。
- 重置展开把两个偏移恢复到 0。

### 6.3 竹筒弧面

- 固定显示完整圆柱的 `2π/3`，即 120° 开放弧段；它不是另一个拓扑。
- `W` 列均匀映射到弧段，逻辑列偏移仍按 `W` 周期。
- 横向拖动使棋局在弧面上循环平移；释放后按列吸附。
- 相机禁止自由旋转和 pan，只允许滚轮/双指缩放。
- “自动旋转”在此视图中实际是自动横向滑动，速度约 30 秒一圈；默认关闭。

### 6.4 完整 3D

- 使用 Three.js/WebGL 或等价实现。
- 桌面端右键拖动旋转，左键只用于落子；触屏单指拖动旋转；滚轮或双指缩放；禁止 pan。
- 提供重置视角和自动旋转，默认关闭。
- 竹筒默认自动转速约 `0.72`，甜甜圈与莫比乌斯约 `0.68`（按 OrbitControls 语义）。
- 设备像素比上限 2，防止高 DPI 设备无界增加 GPU 成本。
- 点击与拖动的阈值为 6 CSS 像素。只有主指针的左键/轻点无拖动释放才可落子；右键只可平移或旋转且必须抑制棋盘上下文菜单；必须处理 `pointercancel` 和 pointer capture，禁止右键、第二触点或左键拖动误落子。
- 甜甜圈和莫比乌斯必须使用共享的玩家视角照明：主光和补光跟随相机/观察目标，并提供不过曝的全向保底光。无论转到外圈、内圈、扭转处或背光侧，木纹、网格、黑白棋子、最后一手和候选标记都必须保持可辨；允许保留柔和阴影来表达曲率，但不得出现影响落子判断的黑面。

### 6.5 所有视图共享的表现

每个视图必须显示同一组信息：

- 黑白棋子、当前行棋方预览、最后一手标记；
- 点目阶段的死子标记；
- AI 局势分析的最多五个候选点、当前悬停/固定变化和最多八手序号；
- 聊天棋点引用的临时高亮；
- 当前拓扑的接缝提示和用户可见坐标。

切换视图不得修改棋局、手数、相机以外的持久化状态或网络状态。视图模式、相机角度、展开偏移和自动旋转只属于本地 UI，不进入房间协议。

### 6.6 棋点聚焦

- `focusPoint({row,col})` 必须把目标移动到当前视图容易看到的位置。
- 平面/弧面选择离当前偏移最近的周期副本。
- 3D 视图转动相机面对目标，并停止自动旋转。
- 聊天引用自动高亮 8 秒；新收到的引用可只高亮而不突然移动相机，用户主动点击引用时才移动相机。

## 7. 围棋规则

### 7.1 棋子、棋块与气

- 交叉点值只能是 `null`、`black` 或 `white`。
- 同色棋子经拓扑邻接连续相连构成棋块。
- 一块棋的气是其所有棋子相邻空点的**去重集合**。
- 黑方先行，成功落子或停着后轮换行棋方。

### 7.2 落子事务

一次 `play(row,col)` 必须按以下顺序执行，并保证失败时任何状态都不变化：

1. 当前阶段必须是 `play`。
2. 坐标在范围内且为空。
3. 暂时放入当前颜色棋子。
4. 收集相邻的对方棋块；将零气棋块全部提走。
5. 若新棋所在棋块仍无气，判定自杀，恢复落子前棋盘。
6. 对提子后的棋子布局计算位置哈希；若历史中已出现，判定位置超级劫，恢复落子前棋盘。
7. 将新布局加入历史，增加提子数，清零连续停着数，记录最后一手、悔棋和复盘，再轮换行棋方。

不允许自杀；没有新西兰式自杀例外。

### 7.3 位置超级劫

- 比较对象只包含棋子布局，不包含行棋方、提子数或阶段。
- 初始布局必须进入 `positionHistory`。
- 成功的普通落子布局进入历史；停着不进入。
- 规则禁止重现任意更早布局，不只是上一劫局面。
- 非法试走不得污染位置历史。
- 悔棋必须删除被撤落子产生的历史布局，使合法性精确回到撤回前。

### 7.4 停着和进入点目

- `pass()` 只在 `play` 阶段合法。
- 普通落子把连续停着数重置为 0。
- 第一次连续停着后数值为 1；双方连续各停一手后进入 `scoring`。
- 进入点目本身不自动判断死活。
- controller 组合含人类时由人类标记死子；纯 AI 自对弈是例外，见 9.3。

### 7.5 死子与领地

- 点目阶段点击一个非空点，必须把它所在的完整棋块统一切换为“死”或“活”。
- 计算时先在临时棋盘上移除已标死棋子，不修改原棋盘。
- 对每个未访问空区用当前拓扑邻接洪泛。
- 若该空区只接触一种颜色，则全部归该颜色；接触双方或不接触任何颜色则为公气。
- 返回领地分区、各色领地点、活子数、死子数、提子数、公气点、总分、胜方和目差。

### 7.6 计分公式

日本数目规则 `japanese`：

~~~text
black = 黑地 + 黑方已提子 + 白方标死子
white = 白地 + 白方已提子 + 黑方标死子 + komi
~~~

中国面积规则 `chinese`：

~~~text
black = 黑活子 + 黑地
white = 白活子 + 白地 + komi
~~~

总分相等为和棋，否则分高者胜，`margin = abs(black-white)`。

### 7.7 点目确认和恢复行棋

- match session 始终维护黑白两方的点目确认；任何死子修改都会清空已有确认，最终只在所需确认齐全后调用同一个 `finishScoring`。
- 两方都是在线真人时，必须由两个已认证席位分别确认。本地同设备对弈由该设备依次代表它拥有的控制器确认；人与 AI 时，AI 不独立判断异形棋盘死活，人类确认后 session 可代表自动 AI 席位补齐确认，因此表现为“直接确认”。
- 任一方认为死活有争议时可恢复行棋。恢复后阶段变为 `play`，连续停着清零，死子和结果清空，下一手沿用点目时引擎记录的行棋方。
- `finished` 阶段不可继续落子或改死子，只能复盘、悔棋允许的历史、导出或建立新局。

### 7.8 规则边界

当前“完整围棋规则”指落子—连通—数气—提子—禁自杀—位置超级劫—双停—人工死活—中日点目的完整可玩闭环。它不应被描述为某一围棋协会全部竞赛细则的逐条实现。

## 8. 对局状态机

### 8.1 棋局阶段

~~~mermaid
stateDiagram-v2
    [*] --> play: 新局
    play --> play: 合法落子 / 一次停着
    play --> scoring: 连续两次停着
    scoring --> play: 恢复行棋
    scoring --> finished: match session 收齐所需确认
    finished --> [*]: 建立新局
~~~

阶段常量必须为：

- `play`：允许落子、停着和普通悔棋。
- `scoring`：禁止落子；允许切换整块死活、查看实时分数、恢复行棋或确认结果。
- `finished`：结果冻结。

### 8.2 唯一 match session 与两个正交轴

产品不得再把“本地交替 / 人与 AI / AI 自对弈 / 联机”实现成四套互斥 UI 或四条业务分支。运行时只有一个 `MatchSession`、一套棋局动作、一套规则状态机和一份 live snapshot；差异只来自两个正交配置轴：

~~~ts
type TransportKind = "local" | "online";
type ControllerKind = "human" | "ai";

interface MatchSessionConfig {
  transport: TransportKind;
  controllerByColor: {
    black: ControllerKind;
    white: ControllerKind;
  };
}
~~~

| 轴 | 取值 | 只决定什么 | 不得决定什么 |
| --- | --- | --- | --- |
| `transport` | `local` | 动作直接交给当前浏览器内的 session adapter/`GoEngine`，由本标签页保存快照和计时 | UI 结构、规则、AI 是否可用、动作名称 |
| `transport` | `online` | 动作包装为幂等命令并同步到 Durable Object，DO 快照是唯一权威 | 另建一套联机棋盘、设置 DOM 或联机专用规则 |
| `controllerByColor[color]` | `human` | 该颜色等待被授权的人类输入 | 数据存放在本地还是在线 |
| `controllerByColor[color]` | `ai` | 该颜色由当前浏览器中的 KataGo Worker 产生动作 | 把模型或推理移到服务端 |

四种 controller 组合都复用同一 match session，但当前 transport 支持矩阵并不对称：`local` 支持 `human/human`、`human/ai`、`ai/human`、`ai/ai`；`online` 当前支持 `human/human`，以及“房主真人黑方 + 自动 KataGo 白方”。在线 AI 黑方或在线 AI 自对弈属于未来扩展，不是当前验收或发布声明。`online-spectator` 是在线 session 的只读访问身份，不是第五种规则模式；`replay` 是覆盖 live session 的只读展示层，也不是 transport 或 controller。

UI 只调用统一业务意图，例如 `play`、`pass`、`toggle_dead`、`finish_scoring`、`resume_play`、`undo`、`resign` 和 `new_game`。`local` adapter 同步调用本地引擎；`online` adapter 将意图路由为协议允许的明确命令，例如真人 `play/pass`、自动白方 `ai_play/ai_pass`、人机直接悔棋 `direct_undo_ai_round`。命令名可以反映不同权限边界，但不得产生第二套规则或棋盘。任何组件都不得用“当前模式”直接改棋盘，或维护一份本地/AI/联机专属棋局副本。

每个在线权威 snapshot 必须带 `positionToken`。它是 DO 对当前引擎位置做的稳定指纹，不是身份凭据；协议再用独立 `expectedMoveCount` 防止相同盘面阶段的异步歧义。在线 AI 请求启动时同时捕获两者；结果返回或命令到达时任一值已变化，必须丢弃或由 DO 以 `STALE_GAME_STATE` 拒绝，绝不能把旧局面的 AI 落点应用到新局、悔棋后或重连后的局面。本地 AI 继续用本机任务 ID/当前引擎状态执行同等 stale 防护，不要求伪造一个在线 token。

进入复盘时应停止当前 AI 请求；退出复盘后若 live session 仍满足 AI 自动行棋条件，再从最新本地状态或在线 `positionToken` 继续。复盘拥有临时展示拓扑，不能改写 live 棋局的拓扑、transport 或 controller 配置。

## 9. Match session 组合详细要求

### 9.1 本地 transport

- 默认 `transport=local`，不需要登录或网络；默认双方 controller 都是 `human`，同一设备按黑白顺序操作。
- 非法动作显示原因并保持 session snapshot、positionToken、计时和 replay 全部不变。
- 本地 adapter 是唯一允许直接调用 live `GoEngine` 的入口；UI、AI Worker、棋盘视图和聊天面板都不能绕过它。
- 刷新页面不承诺恢复本地棋局；切换到在线 transport 前，应在当前标签页内暂存整个本地 match session，退出房间后可恢复。

### 9.2 人类与 AI controller

- 任一颜色都可设为 `human` 或 `ai`；人类执白时，黑方 AI 在 session 建立后自动下第一手。
- AI controller 与人类 controller 读取同一个权威 snapshot。AI 思考期间仍允许旋转、缩放、切换视图和侧栏，但人类不能代替当前 AI 颜色落子。
- 在线 AI 请求绑定发起时的 `positionToken + expectedMoveCount`；推理结束后先核对 token、phase、currentPlayer 和 controller，再通过 online adapter 的 `ai_play/ai_pass` 提交。本地 AI 使用同一调度规则但直接调用 local adapter。
- 模型失败时保留原 session 和局面，暂停对应 AI controller 并明确报错；不得静默改用另一模型或另一种垃圾 AI，也不得偷偷把该颜色改成人类。用户可重试、在新局设置中改变 controller，或显式接管。
- local controller 的改变随新局生效。online 当前只有黑方房主可用显式 `attach_ai/detach_ai` 管理空白方自动席；DO 广播席位变化，不能在客户端无提示地改 controller。

### 9.3 AI 自对弈

- 当黑白 controller 都为 `ai` 时，双方默认使用**同一个用户所选模型**并共用一个已加载的 Worker/模型实例，避免复制显存。
- 每次只允许一个串行搜索；一手完成、经当前 transport 确认并渲染后等待约 420 ms，再从新 `positionToken` 开始另一方。
- 提供“暂停对弈/继续对弈”。暂停正在搜索的请求时终止 Worker；若刚好处在两手间，只停止调度。
- 暂停后可切换视图、进入复盘或按 session 权限悔一步；运行中禁止手动落子和悔棋。
- 两个 AI 连续停着后，自动停止在 `scoring` 并进入暂停。由于当前 AI 不提供可靠的异形棋盘死活判定，房主/本地观察者必须先标记死子再确认结果；也可以悔掉第二次停着，或恢复后继续。不得自动冻结临时分数。
- AI 自对弈当前只在 `local` transport 交付。架构允许未来把两个 AI controller 接到 online adapter，但在线 AI-AI 尚未实现，不进入当前功能、测试、线上 smoke 或完成定义。

### 9.4 在线 transport、自动白方与观战

- 普通真人房中，创建者获得黑方，第二位申请棋手获得白方；两个席位满后后来者成为旁观者。加入弹层必须另有“仅观战”，即使有空席也不能擅自改成玩家。
- 在线房间先由真人黑方房主创建。白席为空且棋局仍在 `play` 时，房主可发送 `attach_ai(modelId)`；DO 持久成员仍为 `role:"player"`，并附 `automated:true/color:"white"/modelId/controllerId:<黑方 playerId>`，公开 snapshot 将该席位投影为 `role:"ai"`。前端从公开 `players` 派生 `controllerByColor`，snapshot 不另发一份顶层 controllerByColor。
- 房主浏览器加载 KataGo，并继续使用**房主已有的房间身份和 token**控制白方 AI；不存在第二个 AI proxy token、私有代理 session 或额外 WebSocket。轮到白方时 online adapter 发送明确的 `ai_play` 或 `ai_pass`，payload 带 `expectedMoveCount`、`expectedPositionToken` 和落点（若有）。
- DO 对 `ai_play/ai_pass` 依次验证：命令发送者是当前黑方房主、自动白席存在且其 `controllerId` 等于发送者、手数与 positionToken 新鲜、当前为白方 AI 回合、动作满足普通合法性和时钟规则。任一失败都不得修改棋局；显式 AI 命令是权限边界，不是绕开 GoEngine 的后门。
- 自动白席被视为已占用，真人不能抢占；房主可用 `detach_ai` 释放它。房主断线不释放 AI 席位，也不暂停权威时钟；恢复后先 sync，旧 token 的推理结果一律丢弃。若模型未及时应手，白方按普通棋手规则超时。
- 黑方房主可建立新局或管理自动白席；当前不支持独立于颜色的房主、自动黑席或两个自动席位。
- 同一房主身份在新窗口连接时，新连接替代旧连接，旧连接停止重连。断线保留黑方与自动白席；只有 `detach_ai`、授权离开或房间到期才释放相应席位。
- 最多 32 名旁观者、64 条连接。旁观者可查看任何 controller 组合的棋局、复盘和聊天，但不能改变 live session；其 AI 分析、自选点和变化只在本机内存。

### 9.5 主时间与日式读秒

计时是可选的新局设置，不改变未计时旧房间：三个字段全部为零或缺省时 `timeControl = null`。界面提供以下快速项，并允许自定义：

| 快速项 | 主时间 | 日式读秒 |
| --- | ---: | ---: |
| 无计时 | 0 | 无 |
| 快棋 | 5 分钟 | 3 次 × 20 秒 |
| 标准 | 20 分钟 | 5 次 × 30 秒 |
| 长考 | 45 分钟 | 5 次 × 60 秒 |

- 自定义 UI 的主时间为 0–180 分钟，读秒 1–20 次、每次 5–300 秒；底层协议的防御性上限为主时间 7 天、读秒 100 次、单次 3,600 秒。读秒次数和秒数必须同时为零或同时为正整数。
- 两张 OGS 风格棋手卡常驻侧栏顶部，分别显示姓名/席位、主时间或当前读秒、剩余读秒次数与当前活动方；最后 10 秒使用紧急视觉语义，但声音不是唯一提示。
- 只有 `play` 阶段、黑白席位都存在且没有待处理悔棋申请时才运行时钟。缺少任一席位、进入点目、终局或悔棋协商期间暂停；网络断线本身**不暂停**，防止主动断网获得额外思考时间。
- 落子或停着成功时先扣除走子方从 `activeSince` 到服务端接收时刻的耗时，再切到下一方。主时间耗尽后进入读秒；完整消耗一个读秒周期就减少一次，若在当前周期内走完则把幸存周期重置为完整秒数。
- 联机以 Durable Object 的时间和状态为唯一权威；浏览器只根据 `serverNow` 做平滑倒计时投影，不能提交剩余时间或自行裁决。服务端 alarm 在最终截止时刻物化超时，并用 `min(turnDeadlineAt, roomExpiresAt)` 安排下一次唤醒。
- 恰好在最终截止时刻到达的棋步先判超时并拒绝，之后所有改变棋局的动作（建立新局除外）返回 `GAME_TIMED_OUT`；`sync` 与 `leave` 仍可用。结果为 `{reason:"timeout", winner, loser, margin:0, finishedAt}`，时钟停止、悔棋/点目确认清空，所有客户端和旁观者收到同一终局。
- 两种 transport 使用同一计时纯函数。`local` 由 match session 中的本标签页时钟裁决，AI 自对弈暂停时暂停本地时钟；`online` 只接受 DO 权威时钟。自动白方的模型加载、后台标签页或房主断线本身不暂停在线时钟。
- SGF 导出必须把黑超时写为 `RE[W+T]`、白超时写为 `RE[B+T]`；导入后按标准 `RE` 文本展示，不伪造目差。

公开房间快照的 `timeControl` 至少为：

~~~ts
interface TimeControlSnapshotV1 {
  enabled: true;
  version: 1;
  mainTimeSeconds: number;
  byoYomiPeriods: number;
  byoYomiSeconds: number;
  players: Record<Color, {
    mainTimeRemainingMs: number;
    byoYomiPeriodsRemaining: number;
    byoYomiTimeRemainingMs: number;
  }>;
  activeColor: Color | null;
  activeSince: number | null;     // 快照中锚定到 serverNow
  running: boolean;
  serverNow: number;
  turnDeadlineAt: number | null;
  outcome: { reason:"timeout"; winner:Color; loser:Color; finishedAt:number } | null;
}
~~~

## 10. 悔棋、完整复盘与音效

### 10.1 悔棋

- 引擎保存最近 32 个成功 `play/pass` 的完整撤销快照；这是持久化硬上限。
- UI 始终发出同一个 `undo` 业务意图；match session 根据 transport、controller 归属和当前身份决定直接执行还是进入协商，视图组件不得自行撤子。
- 同设备 `human/human`：一次直接撤回最近一手。
- 本地 `human/ai` 或 `ai/human`：人类可直接悔棋，不需要 AI 批准；撤回到人类上一次决策之前。在线当前只支持真人黑方/AI 白方，同样提供直接悔棋；adapter 发送 `direct_undo_ai_round` 和 `expectedMoveCount + expectedPositionToken`，DO 确认发送者正控制自动白席后原子撤回相应一轮并广播。
- `ai/ai`：必须先暂停，然后由房主/本地观察者直接撤回最近一手，并保持暂停；在线同样由 DO 执行，不能只改代理浏览器。
- 在线 `human/human`：不能直接撤回；只在 `play`、双方席位存在且至少有一手时申请，申请期间冻结落子和停着。对方可同意/拒绝，申请者可取消；只有同意后才撤回最新一手。
- 联机悔棋请求必须携带目标手数与请求修订号，延迟响应不能误处理较新的请求。
- 撤回第二次停着时，必须退出点目并丢弃随后做出的死子和结果决定。

### 10.2 认输

- 点击“认输”必须先显示二次确认，清楚标出认输方和胜方；取消确认不改变棋局、时钟、复盘或房间 revision。
- 同设备 `human/human` 由当前行棋方认输；人机组合始终由人类颜色认输，即使当前正在等待 AI 行棋也不得把 AI 误记为认输方。该语义不因 transport 改变。
- 在线真人席位在棋局尚未结束时都可认输，不受当前轮次限制，也不需要对手同意；人机房只有真人黑方可主动认输。服务端从已认证成员身份和公开席位派生的 controller 关系推导认输方，拒绝客户端伪造颜色，并立即广播一致终局。
- 旁观者、复盘会话和纯 `ai/ai` session 不能认输；不能只隐藏按钮，match session、transport adapter 和服务端都必须执行同一权限判断。
- 认输立即进入 `finished`，胜方为另一颜色、目差为 0、原因是 `resign`；停止计时、清空待处理悔棋与点目确认，并禁止后续落子、停着或改死子。
- 认输必须进入 ReplayV1：本地棋局可记录 `resign` 事件；在线房间的公开 replay 可使用不计手数的 `outcome.reason="resign"`，以保持服务端持久状态可由上一版本安全读取。两种形式都必须在最终帧重建相同结果；SGF 不创建虚构棋步，而在根节点写标准 `RE[B+R]` 或 `RE[W+R]`。

### 10.3 完整复盘数据

复盘不得依赖 32 手悔棋窗口。`ReplayV1` 必须包含：

- `version = 1`；
- `complete`：是否从真实开局开始；
- 不含嵌套 replay 的 `base` 权威状态；
- 无界的线性事件数组 `events`。

事件类型：

- `play {color,row,col}`
- `pass {color}`
- `resume_play {nextPlayer}`
- `toggle_dead {row,col}`
- `finish_scoring {rule}`

普通落子与停着各增加一个播放帧；死子、恢复和最终点目只更新当前手数对应帧，不额外增加“手”。最终死子和结果必须能精确还原。

旧存档没有 replay 时，从恢复后的当前局面建立 `complete=false` 的续录棋谱，并在 UI 标注“续录复盘”。

### 10.4 复盘播放器

- 至少下一手后才可进入。
- 控件：开头、上一步、播放/暂停、下一步、结尾、可拖动手数滑杆。
- 速度：`0.5×`、`1×`、`2×`；默认基准间隔 900 ms，因此实际间隔为 `900/speed` ms。
- 到结尾自动停止；在结尾按播放从开头重新开始。
- 正向逐手或自动播放时播放落子/提子音效；任意跳转不应制造一串重叠音效。
- 复盘中可切换该拓扑支持的任何视图，且与原对局使用的视图无关。
- 复盘不改变当前棋局；退出后回到最新权威局面。
- 在线复盘源来自房间快照中的完整 replay；房间可能继续收到新状态，退出复盘后应同步最新局面。
- 进入本地或导入 SGF 的复盘时，顶部和设置区三个拓扑按钮必须立即按复盘帧的 `topology` 同步高亮和 `aria-pressed`，并在复盘期间禁用“以按钮建立新局”。
- 退出复盘时必须用 live `game.topology` 重建视图并恢复三个按钮的高亮；例如甜甜圈 live 棋局导入竹筒 SGF 后，复盘显示竹筒，退出后必须重新显示甜甜圈，不能遗留错误按钮或几何。

### 10.5 音效

- 使用 Web Audio 动态合成，无需额外音频文件。
- 落子声是约 72 ms 的低沉木质短击。
- 提子声在落子声后约 58 ms 播放，清脆且随提子数量略微升调；2 子以上至多 2 个脉冲，6 子以上至多 3 个，防止大龙被提时过响过长。
- 默认总音量约 `0.72`，右上角可开关；设置保存在 `localStorage["3d-baduk-sound-enabled"]`。
- 第一次可信用户手势时解锁 AudioContext。浏览器不支持、拒绝自动播放或音频设备失败时，棋局必须照常工作。


## 11. KataGo 混合 AI

### 11.1 定位

本项目只保留 KataGo 混合 AI。它不是完整原生 KataGo 引擎：

1. KataGo 神经网络在根局面给出全盘策略 logits。
2. 本项目按当前拓扑进行每层卷积边界填充。
3. `GoEngine` 对每个点执行精确合法性掩码。
4. 自定义拓扑感知 MCTS/战术搜索使用策略先验，同时保持跨缝提子、救棋、打吃、防自填眼和超级劫为权威。
5. 最终落点必须再次经 `GoEngine.play/pass` 验证。

不得退回纯随机或纯蒙特卡洛对手。

### 11.2 模型目录

| ID | 网络 | 压缩大小 | 后端 | 默认 | 用户文案 |
| --- | --- | ---: | --- | --- | --- |
| `b10` | `g170e-b10c128-s1141046784-d204142634` | 11,138,361 B，约 10.6 MiB | WebGPU → WebGL → CPU | 是 | “快速（特殊棋盘段位未测）” |
| `b18` | `kata1-b18c384nbt-s9996604416-d4316597426` | 97,898,094 B，约 93.4 MiB | 仅 WebGPU | 否 | “增强（高耗资源 · 段位未测）” |

要求：

- b18 只在检测到桌面浏览器 WebGPU 时可选。
- 选择 b18 前显示明确警告：首次下载约 93.4 MiB、会占用数百 MiB 内存/显存，并增加等待、耗电和发热。
- 模型选择保存在 `localStorage["3d-baduk-ai-model"]`，未知 ID 回退 b10。
- b10 是一个 gzip 资源；b18 原始 gzip 无损切成四片，大小分别为 25,165,824、25,165,824、25,165,824、22,400,622 字节。
- 四片顺序下载、拼接并校验总长度后再解析。拆分只为满足 Cloudflare 单个静态资源 25 MiB 上限，不改变网络内容。
- 下载请求使用浏览器缓存；缓存命中仍需在新 Worker 中解析网络并上传 GPU。
- 模型失败或后端不可用时不得静默改用另一模型。
- 必须随分发包保留 `THIRD_PARTY_NOTICES.md` 和 `/KATAGO_NETWORK_LICENSE.txt`。

### 11.3 强度说明

KataGo 是很强的开源普通围棋引擎，但本项目的 b10/b18 网络没有训练竹筒、环面或莫比乌斯接缝，而且这里只把网络策略接入自定义短搜索。因此：

- 可以说“b18 通常比 b10 给出更准确的全盘策略”。
- 不得写“b10 等于业余几段”或“b18 等于职业几段”。
- 统一显示“特殊棋盘段位未测”。
- 需要真人对局和固定预算 A/B 比赛后才能建立本项目自己的等级标定。

参考：[KataGo 官方项目](https://github.com/lightvector/KataGo)、[官方网络列表](https://katagotraining.org/networks/)、[网络许可](https://katagotraining.org/network_license/)。

### 11.4 拓扑感知神经推理

输入使用 NHWC：

~~~text
spatial: [1, H, W, 22]
global:  [1, 19]
policy legal mask: W × H + 1（最后一个是 pass）
~~~

空间特征至少包含有效棋盘、己方/对方棋子、1/2/3 气棋块、最近一手等；全局特征包含贴目、规则、连续停着和位置超级劫规则提示。棋块气必须来自权威引擎。

每一层卷积都按拓扑填充，而不是只改第一层：

- 竹筒：横向循环填充，纵向零填充。
- 甜甜圈：横向与纵向都循环填充。
- 莫比乌斯：横向 halo 从对边取值并反转行序，纵向零填充。

矩形棋盘必须原生以 `H × W` 运行；不得假定 19×19 或用 `row*height+col`。策略索引统一为 `row*width+col`。

### 11.5 搜索预算和线程

正式对局默认：

~~~text
difficulty = hard
timeLimitMs = 1400
maxIterations = 800
rolloutLimit = min(16, 2 × W × H)
candidateLimit = 24（Worker 强制）
~~~

- 推理和搜索都运行在 Web Worker，主线程保持可交互。
- 同一 Worker 一次只处理一个任务；新任务取消同 ID 的旧任务。
- 进度阶段为 `loading_model`、`neural_inference`、`searching`。
- 搜索必须支持 AbortSignal/协作取消；需要立即停止重型 b18 时允许终止 Worker。
- 模型只提供根策略；界面中的短搜索 `winRate` 是当前搜索的启发式估值，不是官方 KataGo 胜率。

### 11.6 AI 局势分析与复盘

同一套浏览器 Worker 分析器必须支持本地实时局面、观战局面和复盘帧。AI 不通过 API 调用，也不消耗 Durable Object 的 CPU/GPU；服务端只继续广播权威棋局。

权限与隔离：

- local session 的任意 controller 组合，以及已暂停且身份获准的 AI 自对弈局面，可在本机分析；进入点目或终局后不再请求落点建议。online 则继续遵守棋手公平限制和观战本地分析规则。
- 旁观者可对正在进行的权威局面分析，并可在棋盘上选择一个合法空点建立“自选点”分支。分析输入是权威快照的深拷贝；结果、候选悬停、自选点和分支棋子只存在当前浏览器内存，不能发送 `play`、聊天、分析结果或任何新协议字段。
- 为保证公平，在线黑白双方在对局仍处于 `play` 且未超时时禁用实时 AI，也禁用针对该进行中棋局的 AI 复盘；终局后才能分析。仅隐藏按钮不够，调用入口也必须执行同一权限判断。
- 棋局更新时取消旧局面的进行中请求，并以包含宽、高、拓扑、轮次、阶段、手数和棋盘的 position key 丢弃迟到结果，不能把上一局面的建议画到新棋盘。

分析预算：

| 动作 | 时间上限 | 最大迭代 | rollout 上限 |
| --- | ---: | ---: | ---: |
| 分析当前手 | 1,200 ms | 700 | 14 |
| 快速分析整局 | 280 ms/局面 | 180/局面 | 7 |

- “快速分析整局”只出现在复盘中；它串行执行，只分析可行棋的局面，可随时停止。实时局势和观战局势只有“分析当前局面”。
- 结果按“模型 ID + 手数”在本次复盘会话内缓存；b10 与 b18 结果不能混用。
- Worker 搜索统计可保留最多 25 个有界候选；界面按访问量展示最多五个，每个包含落点、访问数/占比、启发式胜率和最多八手的 `variation/PV`。`pass`、矩形棋盘和三种拓扑必须安全处理。
- 候选以 1–5 编号和彩色标记同步画在当前平面、弧面或 3D 视图。鼠标悬停或键盘聚焦时临时预演该候选的后续变化；移开恢复原局面；点击候选可固定/取消固定分支。固定状态只属于当前“模型 + 局面”，换帧、换模型或棋局更新时重置。
- 变化预演必须用 `GoEngine.fromState` 在局面副本上逐手执行，遇到非法棋步、点目或最多八手时停止；预演不得修改 live/ReplayV1、播放光标、提子数或网络状态。
- 复盘同时说明实战下一手是首选、第几候选或候选外；“候选外”不得解释为“一定是坏棋”。观战实时分析则明确标注“仅在本页，不影响比赛双方”。
- b18 整局分析要再次确认高资源消耗。
- 停止分析后保留已完成结果；退出复盘可销毁分析 Worker。

## 12. SGF 标准兼容和异形扩展

### 12.1 兼容目标

使用 SGF FF[4] 的标准文本、树语法、矩形尺寸和 Go 棋步。普通 SGF 阅读器应能读取导出的黑白落子与停着；但普通阅读器不知道周期接缝，可能在提子、合法性和点目上得到不同结果。只有识别本项目扩展的客户端才能完整重现异形规则。

规范依据：[SGF FF[4] 官方规范](https://www.red-bean.com/sgf/)、[属性定义](https://www.red-bean.com/sgf/properties.html)、[Go 坐标与停着](https://www.red-bean.com/sgf/go.html)。

### 12.2 标准导出

根节点必须按 FF[4] 生成，至少含：

~~~sgf
(;FF[4]GM[1]CA[UTF-8]AP[3D Baduk:1]
  SZ[19]KM[7.5]RU[Chinese]XTOP[cylinder]
  ;B[pd];W[dd];B[])
~~~

规则：

- 正方形输出 `SZ[N]`；矩形输出标准 `SZ[width:height]`。不得输出非法的 `SZ[N:N]`。
- 使用 `B[xy]` / `W[xy]`；停着统一输出 `B[]` / `W[]`。
- 非空初始局面用根节点 `AB` / `AW`，非黑先用 `PL`。
- 尽可能写出 `PB`、`PW`、`RE`、`KM`、`RU`。
- 结果字符串支持 `B+数字`、`W+数字`、`B+R`、`W+R`、超时 `B+T/W+T` 和和棋 `0`。
- 文本中的反斜杠和 `]` 必须正确转义；统一 UTF-8。
- 文件名形如 `3d-baduk-{topology}-{W}x{H}-{timestamp}.sgf`。
- 导出使用 Blob 下载，不上传服务器。

### 12.3 私有扩展

| 属性 | 值 | 语义 |
| --- | --- | --- |
| `XTOP` | `cylinder/torus/mobius` | 权威棋盘拓扑 |
| `XRESUME` | `B/W` | 恢复行棋并指定下一方 |
| `XDEAD` | SGF 点 | 切换该点所在整块死活 |
| `XFINISH` | `chinese/japanese` | 按指定规则冻结点目 |
| `XCONFIRM` | `B/W` | 联机点目确认；不是 GoEngine 棋步 |
| `XCOMPLETE` | `0/1` | 棋谱是否从真实开局开始；真值可省略 |

这些属性都是大写、可解析的私有属性。标准建议私有属性 ID 尽量短，但 FF[4] 语法允许多个大写字母；这里为可读性使用上述稳定名字。普通阅读器应忽略未知属性，不过老旧软件可能丢弃它们，因此“普通 SGF 往返后仍保留异形语义”不作保证。

### 12.4 导入策略

- UI 只接受 `.sgf`/文本文件，文件硬上限 2 MiB。
- 导入只打开一个**独立复盘会话**，不覆盖当前正在下的棋局。
- 解析完整 collection 以保证语法安全，但只选第一局的第一个主分支；其他局和变化分支返回结构化警告。
- 缺 `GM` 时假定 Go；`GM != 1` 拒绝。
- 非 FF[4] 可按 FF[4] 兼容规则尝试并警告。
- 缺 `SZ` 时假定 19×19。当前 `SGF_DEFAULT_LIMITS.maxBoardDimension = 25`，导入/复盘和底层 GoEngine 允许宽、高各 3–25；新建棋盘 UI/公开建房请求仍只允许 5–25。FF[4] 坐标字母表理论可表达到 52，但这不是当前解析上限。
- 缺 `XTOP` 时，采用用户当前待选拓扑，默认竹筒，并明确警告“原谱未写异形拓扑”。
- 未知拓扑值拒绝，绝不猜测。
- `RU` 中 Chinese/AGA/New Zealand/Tromp 归为中国面积；Japanese/Korean 归为日本数目；未知规则回退日本并警告。
- `B[]/W[]` 是停着；19×19 及以下兼容旧 `tt` 停着并警告。
- 根节点 `AB/AW/PL` 转为 replay base；压缩点列表可展开。
- 中盘 `AB/AW/AE` 和中盘任意改行棋方无法表达为当前线性 replay，必须忽略并警告，不能静默执行。
- 非轮流 B/W 可以解析并警告；在构建权威复盘帧时若按当前拓扑不合法，整体导入失败且不改变现有 UI 状态。
- 未识别的 `X*` 属性作为元数据返回；当前 UI 不承诺编辑后完整往返。

### 12.5 解析资源边界

默认限制：

| 项目 | 上限 |
| --- | ---: |
| 输入/输出 UTF-8 字节 | 2 MiB |
| 节点 | 10,000 |
| 变化树深度 | 64 |
| 每节点属性 | 256 |
| 全文件属性值 | 20,000 |
| 单值长度 | 256 KiB |
| 属性 ID 长度 | 32 |
| 当前 SGF 导入维度 | 每轴 3–25（`maxBoardDimension=25`） |

含 NUL、未结束属性、越界点、零尺寸、过深/过大输入必须抛出结构化 `SgfError`，不得部分修改棋局或把 SGF 内容插入 HTML。

## 13. 在线房间与权威同步

### 13.1 总体架构

目标线上版本及当前工作区 Worker 代码采用同源单 Worker 架构；公开入口是否已经包含本节全部增量，必须以第 21.4 节部署后验证为准：

~~~text
浏览器（静态 UI + 本地 Three.js/TF.js/KataGo）
        │ HTTPS / WSS
Cloudflare Worker（静态资源、REST 路由、同源校验）
        │ Durable Object binding: BADUK_ROOMS
BadukRoom Durable Object（每个房间一个权威顺序执行器和持久状态）
~~~

- Vite 构建产物位于 `dist/`，由 Workers Static Assets 提供；`/api/*` 必须先经过 Worker，其他未知前端路由回退 SPA。
- 每个房间码通过 `BADUK_ROOMS.getByName(code)` 定位唯一 Durable Object，因此同房间命令串行执行。
- Durable Object 类名为 `BadukRoom`，SQLite 迁移标签为 `v1`，存储主键为 `room`，可观测性打开。
- 页面仍运行第 8.2 节的同一个 `MatchSession`；进入房间只把 `transportAdapter` 从 local 换成 online。五个侧栏、设置表单、棋盘回调、动作 reducer、Replay 和规则提示都不得重新挂载为另一套“联机版”。
- 联机棋局、房间身份、聊天和断线席位由服务端保存；棋盘渲染、声音、视角、AI 模型及 AI 计算不进入服务端。
- 联机时钟也由服务端保存与裁决；客户端可以按快照投影显示，但不能让浏览器计时覆盖权威剩余时间。观战 AI 完全本地化，既不持久化也不广播。
- Cloudflare 当前对单个静态资源有 25 MiB 上限，因此 b18 必须按校验过的分片部署，不能重新合并成一个约 93.4 MiB 文件。限制参考 [Cloudflare Workers 平台限制](https://developers.cloudflare.com/workers/platform/limits/)。

### 13.2 房间码、身份和席位

- 房间码是 6 位大写字符串，正则为 `[A-HJ-NP-Z2-9]{6}`；字符表 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` 排除易混淆的 `I/O/0/1`。
- 建房最多随机尝试 12 个码；碰撞后重试，耗尽则返回可重试服务错误。
- 创建者获得真人黑方。白席可由第二位真人加入，或由黑方房主在空席时通过 `attach_ai` 接入自动 KataGo 白方；当前不支持自动黑方或在线 AI 自对弈。两席满后再加入者只能观战。加入 UI 必须把“加入对局”和“仅观战”作为两个明确动作；请求 `role:"spectator"` 时不得因有空席而自动改为玩家。
- 每房最多 32 名观战者，最多 64 条同时 WebSocket 连接。席位数和连接数是两个独立限制。
- 观战 HTTP 加入先建立一个临时身份预约；若 60 秒内从未成功建立 WebSocket，该预约必须自动回收，防止恶意请求永久占满 32 个观战名额。
- 观战者至少成功连接过一次后，最后一条连接断开时开始 5 分钟重连宽限；宽限结束仍离线才移除成员。玩家席位不使用这套自动回收，仍只在明确离开或房间到期时释放。
- 玩家名把连续空白折叠成一个空格并去除首尾空白，长度为 1–20 个 Unicode code point。
- `playerId` 是服务端认可的稳定身份，长度 1–128；客户端不能通过消息伪造名字、角色或颜色。
- 会话 token 使用 32 个密码学随机字节并编码为 64 位十六进制；响应只向所属浏览器返回明文，Durable Object 只保存 SHA-256 哈希，比较时使用常量时间逻辑。协议接收 token 的兼容上限为 256 字符。
- 一个玩家身份同一时刻只允许一个活动连接；新连接成功后旧连接收到 `SESSION_REPLACED` 并关闭。
- 网络断开只把成员标为离线，保留座位和 token；明确执行“离开房间”才释放成员和席位。
- 浏览器按房间在 `localStorage` 保存恢复会话；只要房间未过期，刷新或短暂断网后可取回原颜色。用户主动离开、会话被替换且不可恢复或房间过期时删除该 token。
- 自动白席有稳定内部 `playerId` 和不可用于登录的占位 tokenHash，但没有明文 token、私有 session 或自己的连接。公开身份标记 `role:"ai"`、`automated:true`、`modelId` 和 `controllerId`；所有 AI 命令仍由 `controllerId` 对应的黑方房主使用原会话发送。

### 13.3 HTTP 接口

| 方法 | 路径 | 用途 | 成功状态 |
| --- | --- | --- | ---: |
| `GET` | `/api/rooms/health` | 服务健康检查 | 200 |
| `POST` | `/api/rooms` | 创建房间和黑方会话 | 201 |
| `POST` | `/api/rooms/:code` | 加入房间；兼容别名为 `/:code/join` | 200 |
| `GET Upgrade` | `/api/rooms/:code/socket` | 建立房间 WebSocket；兼容别名为 `/ws` | 101 |

建房请求至少支持：

~~~json
{
  "name": "玩家名",
  "width": 19,
  "height": 13,
  "topology": "torus",
  "scoringRule": "chinese",
  "komi": 7.5,
  "mainTimeSeconds": 1200,
  "byoYomiPeriods": 5,
  "byoYomiSeconds": 30
}
~~~

加入请求为 `{ "name": "玩家名", "role": "player" | "spectator" }`。成功响应包含 `code`、公开身份、私有 `token` 和当前房间快照；接入 AI 使用 WebSocket `attach_ai` 命令，不签发新 token。仅正方形兼容响应额外包含 `size`。

边界要求：

- HTTP JSON 请求最大 4 KiB，同时检查 `Content-Length` 和实际 UTF-8 字节。
- 创建/加入/升级只接受同源请求；有 `Origin` 时必须严格等于请求 URL 的 origin。无 `Origin` 仅用于非浏览器健康检查和测试兼容。
- 公共 UI 及新请求只允许宽、高 5–25。现有底层反序列化器曾接受 3–25，这是旧状态读取兼容，不是可创建的产品范围。
- 三个时间字段按第 9.5 节成组验证；全零/缺省保持未计时兼容，非法组合必须在建立房间或新局前原子拒绝。
- 所有错误均返回稳定 `code`、可显示中文 `error` 和正确 HTTP 状态；不得返回堆栈、token 哈希或私有成员数据。

### 13.4 WebSocket 协议 v2

应用子协议固定为 `bamboo-baduk-v2`。服务端可以识别旧 `bamboo-baduk-v1` 和无版本 `bamboo-baduk`，但必须拒绝并提示刷新，不能按旧语义静默运行。token 通过第二个 RFC 6455 子协议值 `token.{base64url(token)}` 携带；不得写到 URL 查询参数或日志。

客户端命令信封：

~~~json
{
  "v": 2,
  "type": "command",
  "id": "客户端生成且不超过128字符",
  "sequence": 42,
  "action": "play",
  "payload": { "row": 3, "col": 4 }
}
~~~

自动白方应手则保持同一信封，改为 `action:"ai_play"`，payload 为 `{row,col,expectedMoveCount,expectedPositionToken}`；停着使用 `ai_pass` 并省略 row/col。

- `sequence` 是每成员严格递增的正安全整数；旧非聊天命令可省略以兼容，但新客户端全部发送。`chat` 必须带 `sequence`。
- `id` 在一个成员的未完成/回执窗口内唯一；服务端保存最近 256 个命令回执，实现重复发送幂等。
- 同一 `playerId + id` 重发时返回原 ACK 或原错误，不重复落子/发消息；小于等于 `lastSequence` 且非已知重复的命令返回 `STALE_COMMAND`。
- 异步 AI 命令 `ai_play/ai_pass` 和人机直接悔棋 `direct_undo_ai_round` 必须同时携带 snapshot 的 `expectedMoveCount` 与 `expectedPositionToken`。DO 在任何规则 mutation 前比较当前值；不一致返回 `STALE_GAME_STATE`，不扣钟、不改 replay。普通同步真人动作继续由身份、轮次、command sequence 和规则校验保护。
- 单条客户端文本 WebSocket 消息最大 8 KiB；只接受合法 JSON 对象。超限先返回错误，再以 4409 关闭。
- 支持动作：`play`、`pass`、`attach_ai`、`detach_ai`、`ai_play`、`ai_pass`、`direct_undo_ai_round`、`toggle_dead`、`finish_scoring`、`resume_play`、`request_undo`、`respond_undo`、`cancel_undo`、`resign`、`chat`、`new_game`、`leave`、`sync`。前端统一 `undo` 意图按席位派生结果路由为 `direct_undo_ai_round` 或真人协商命令。
- 观战者除 `leave` 外的新命令（包括会返回完整快照的 `sync` 和越权动作）必须经过持久化双层 token bucket：单观众突发 3 次、每 3 秒补 1 次；全房观众突发 8 次、每 1 秒补 1 次。已知重复命令直接复用回执，不重复扣费；过期 sequence 也要扣费并在回复前持久化，防止 Durable Object 休眠绕过限流。超限返回可重试的 `SPECTATOR_RATE_LIMITED`，且不得消耗玩家的聊天或命令额度。

服务端消息至少分为：

| `type` | 目的 |
| --- | --- |
| `welcome` | 首次连接的私有身份、权威快照和协议版本 |
| `state` | 棋局/公开成员席位/positionToken/点目/悔棋的完整权威快照 |
| `presence` | 在线状态变化，可与 state 分开发送 |
| `chat` | 单条权威聊天增量及 `chatSequence` |
| `ack` | `{id, sequence?, ok:true, revision}` |
| `error` | `{id?, code, error, retryable?}` |
| `pong` | hibernation keepalive 回应 |

聊天不推进棋局 `revision`，使用独立的 `chatSequence`；因此客户端不得以相同 revision 丢弃聊天事件。完整 state 若未带聊天字段，客户端必须保留已有聊天，而不是清空。

### 13.5 断线、重连和房间寿命

- 客户端重连采用指数退避：初始 500 ms、倍率 2、上限 10 s、随机抖动 ±20%、最多 10 次。
- 命令 ACK 默认等待 12 s；断线后尚未确认的信封保留原 `id/sequence` 重发，由服务端幂等处理。
- 每次成功重连先以 `sync` 或 welcome 全量校准，不把本地乐观棋局覆盖服务端。
- 重连、悔棋、新局、恢复行棋或任何 revision 跳变后，浏览器必须取消旧 `positionToken` 上的在线 AI 请求和延迟 UI 动作；房主只能从最新 snapshot 重新调度自动白方。
- WebSocket 使用 Durable Object hibernation API；服务端支持轻量 ping/pong，不依赖常驻内存定时器维持房间。
- alarm 同时调度计时截止、房间 TTL 和最近的观战预约/重连宽限截止；观战清理只推进成员 revision，不得把它伪装成用户活动并延长 24 小时房间寿命。
- 房间在最后一次有效活动后恰好保留 24 小时。落子、停着、点目、悔棋、认输、合法聊天、加入、离开或已认证恢复会话都可延长；无效攻击请求不能无限续命。
- 到期 alarm 向连接发送 `ROOM_EXPIRED`，关闭 socket、删除 alarm 和 `deleteAll()`；之后同一码视为不存在。
- UI 始终显示“已连接/重连中/已离线/房间过期”，离线时禁止产生看似成功的落子；聊天草稿可以保留在当前标签页。

### 13.6 权威对局语义

- 两位玩家都在房间后才允许第一手；观战者永远不能落子、停着、标死、点目确认、悔棋、认输或发聊天。
- 自动白席计入“两位玩家都在房间”，但 `ai_play/ai_pass` 仍需黑方房主的有效身份、匹配的 `controllerId`、新鲜手数/token 和正确 AI 回合；服务端不因 `automated:true` 跳过规则、时钟或幂等。
- 服务端验证轮次、坐标、合法性、拓扑、超级劫和阶段；客户端预检只用于即时提示。
- 黑方房主独占 `new_game` 权限。新局消息包含最终宽、高、拓扑、规则、贴目和计时；现有真人/自动白席关系保留，controller 仍由公开席位派生。
- 两次连续停着进入 `scoring`。任一棋手可以切换一整块死子；任何死子变更都清空双方确认。
- 在线 `human/human` 由双方分别执行 `finish_scoring` 后进入 `finished`；一方确认时 UI 显示等待对方。人机局由黑方房主确认后，DO 根据自动白席及其 `controllerId` 补齐白方确认。获授权真人可 `resume_play`，清空确认和死子并回到权威下一方。
- 悔棋是协商操作：申请必须带 `expectedMoveCount`；同一时刻最多一份申请；申请方可取消，另一方可同意/拒绝；同意只撤回最后一个棋步并清空申请。申请存在时不允许继续落子或停着。
- 上一条只适用于在线 `human/human`。黑方房主对自动白席时，DO 接受 `direct_undo_ai_round` 并按权威席位关系原子回到黑方上一次决策点；客户端声称“对方是 AI”不能改变服务端判断。
- 认输不是协商操作：已认证真人颜色在未终局时可发起，不受轮次限制且无需对手确认；服务端按成员颜色推导认输方，不能接受客户端提供的 `color/winner/loser`，也不能让黑方以 AI 控制命令伪造白方认输。成功后立即停止时钟、清空悔棋申请与点目确认、持久化并广播。
- 房间快照必须同时带 `revision`（兼容别名 `version`）、`positionToken`、`moveCount`、`game`、`replay`、`timeControl`、`undoAvailable`、`undoRequest`、`scoreConfirmations`、公开 `players/spectators`、聊天摘要和到期时间。controllerByColor 由 `players` 派生，不是顶层协议字段。超时时 `game.phase="finished"`、`game.result`、`replay.outcome` 与 `timeControl.outcome` 必须一致；公开部分不得包含任何 token/hash。

自动白席相关公开字段使用现有 `players` 数组；前端通过 `automated/role` 派生 controller：

~~~ts
interface OnlineRoomSnapshotV2 {
  revision: number;
  positionToken: string;
  players: Array<{
    id: string;
    color: Color;
    name: string;
    role: "player" | "ai";
    online: boolean;
    automated?: true;
    modelId?: "b10" | "b18";
    controllerId?: string;
  }>;
}
~~~

普通真人席位派生为 `human`；`automated:true` 或 `role:"ai"` 的白席派生为 `ai`。`controllerId` 只说明哪位黑方房主获准代发 AI 命令，不是鉴权材料；DO 仍按当前已认证连接核对。任何 token/hash、命令限速桶和内部连接 ID 都必须删除。
- Durable Object 的 alarm 同时负责房间 TTL 和最终用时截止点。每次合法动作、加入/离开、恢复、悔棋协商或 alarm 后重新安排 `min(clockDeadline, expiresAt)`；超时时持久化一次、递增 revision 并广播，随后仍保留 TTL alarm。

## 14. 房间聊天室、表情包和棋点引用

### 14.1 产品行为

“聊天”是五个固定侧栏标签之一，所有 transport 复用同一个 DOM、输入组件和消息列表，不能在本地模式删除/隐藏后再为联机创建另一份：

- `transport=local` 时聊天标签可打开，内容区显示“聊天需要联机房间，可创建或加入房间”的明确引导和入口；不显示伪消息，不把本地输入当作已发送，也不为此建立 WebSocket。
- `transport=online` 时同一组件绑定房间消息源；真人棋手可发送，自动白席不能生成聊天，旁观者实时阅读但输入区禁用并说明“观战者只读”。

- 支持任意合法 Unicode 文字和普通 Emoji，不做敏感词、语义或立场审查，不自动改写、打码或屏蔽正文。
- 仍然执行长度、身份、频率、XSS 和协议校验；“不审文字”只表示不做内容层过滤。
- 只有已认证真人黑白席位可以发送；自动白席和旁观者不能发言。人机房的黑方房主仍以自己的黑方身份聊天，不能伪装成 AI 白方发言。
- 自己和对方的消息使用不同对齐/颜色，显示发送者名字、棋色、正文或表情包；以服务端 `sentAt` 显示时间。
- 发送失败保留输入内容并显示可重试原因；ACK 前可显示“发送中”，幂等重连不得出现重复气泡。
- 新消息在用户已接近底部时自动滚到底；用户正在查看历史时只显示“有新消息”，不强制跳动。

### 14.2 文字限制与防刷屏

文字标准化顺序：`CRLF/CR → LF`，去首尾空白，保留内部空格和换行。空消息拒绝。单条限制：

| 项目 | 上限 |
| --- | ---: |
| Unicode code point | 300 |
| UTF-8 字节 | 1,500 |
| 行数 | 4 |
| 自动识别的不重复棋点 | 4 |

历史保留最近 100 条，同时序列化后最多 64 KiB；超过任一限制从最旧消息开始删除。限速为持久化 token bucket：

- 每成员突发 5 条，此后每 1,200 ms 补 1 条。
- 全房间突发 12 条，此后每 300 ms 补 1 条。
- 无效文字/不存在的表情包也消耗该成员额度，防止绕过；观战者越权尝试只消耗自己的额度，不能消耗共享额度让玩家失声。
- 超限返回 `CHAT_RATE_LIMITED`、HTTP 语义 429 和可重试标记，UI 应根据 `retryAfterMs` 或本地倒计时暂时禁用发送。

### 14.3 固定表情包

不允许上传外部图片。首版固定表情包为：

| `stickerId` | 图形 | 文案 |
| --- | --- | --- |
| `good-move` | 👏 | 好棋！ |
| `thinking` | 🤔 | 让我想想 |
| `surprised` | 😲 | 居然下这里 |
| `laugh` | 😂 | 笑死 |
| `respect` | 🤝 | 承让 |
| `tea` | 🍵 | 喝口茶 |
| `bamboo` | 🎋 | 竹筒之力 |
| `donut` | 🍩 | 甜甜圈时间 |

Emoji 快捷选择器首版固定显示：`😀 😄 😂 😊 🤔 😮 😭 😎 👍 👏 🙏 🔥 🎉 🎋 🍩 🍵 ⚫ ⚪`。Emoji 是插入文字；表情包是 `{kind:"sticker", stickerId}` 的结构化消息，二者不得混淆。

### 14.4 坐标识别

正文按第 2.2 节的可见坐标识别，例如 `D4`、`看 D4 这里`。规则：

- 不区分 ASCII 大小写，允许字母与数字间有空格；显示时统一规范化为大写无空格。
- 只识别当前消息发送时棋盘范围内的点，跳过 `I`；同一坐标只记录一次，最多 4 个。
- 不能把英文/数字词的一部分误判为坐标，例如 `BAD4` 不得提取 `D4`。
- 服务端从已验证正文重新提取，绝不相信客户端随附的 `points`。
- 消息保存发送时的 `boardWidth`、`boardHeight`、`boardTopology`、`moveCount`；仅正方形额外保存旧别名 `boardSize`。

权威消息示例：

~~~json
{
  "id": "player-123:42",
  "sequence": 18,
  "senderId": "player-123",
  "senderName": "黑方",
  "senderRole": "player",
  "senderColor": "black",
  "kind": "text",
  "text": "D4 这里还能断吗？",
  "points": [{ "row": 9, "col": 3, "label": "D4" }],
  "boardWidth": 19,
  "boardHeight": 13,
  "boardTopology": "torus",
  "moveCount": 56,
  "sentAt": 1784420000000
}
~~~

### 14.5 棋点交互

- 正文中被识别的坐标渲染为可聚焦按钮，而不是 HTML 字符串链接。
- 仅当当前棋盘宽、高、拓扑都与消息快照一致时可点击；不一致时显示“上一盘棋的坐标”并禁用，不能把旧坐标映射到新局。
- 点击坐标后在当前平面、弧面或 3D 视图定位并高亮该交叉点 8 秒；它不落子，不改变复盘帧，不自动旋转到令人迷失的新角度。
- 如果坐标当前在曲面背面，允许用最短平移/旋转使其可见；这一动作必须停止自动滑动/自动旋转。
- 可选“从棋盘选点”按钮进入一次性取点模式：下一次合法点按只把坐标插入聊天草稿，绝不落子；Esc、再次点按钮或切换模式可取消。
- 收到新消息时可对第一处坐标做不移动镜头的 8 秒脉冲提示；默认关闭时不得干扰正在思考的玩家。

### 14.6 安全、隐私和可访问性

- 所有文字以 `textContent` 或等价安全文本节点渲染，禁止 `innerHTML`；名字、正文、表情标签和坐标都视为不可信输入。
- 聊天无端到端加密；消息和名字保存在房间 Durable Object，随 24 小时房间 TTL 删除。UI 应在房间帮助文字中明确这一点。
- 服务端派生发送者身份、颜色和时间；客户端只可提交 `kind/text/stickerId`。
- 聊天列表使用日志语义和 `aria-live="polite"`；但不应把历史全量重复朗读。表情包有完整可读标签，坐标按钮的无障碍名称含“定位棋点 D4”。
- Enter 发送、Shift+Enter 换行；输入法合成期间 Enter 不发送。移动端发送按钮尺寸至少 44×44 CSS px。

## 15. 状态模型和序列化契约

### 15.1 逻辑棋局

下面是语言无关的规范性形状；TypeScript 写法仅用于表达字段：

~~~ts
type Color = "black" | "white";
type Topology = "cylinder" | "torus" | "mobius";
type Phase = "play" | "scoring" | "finished";

interface GameStateV1 {
  width: number;
  height: number;
  size?: number;                 // 仅 width === height 时存在
  topology: Topology;
  scoringRule: "chinese" | "japanese";
  komi: number;
  board: (Color | null)[][];     // height 行、每行 width 列
  currentPlayer: Color;
  phase: Phase;
  consecutivePasses: 0 | 1 | 2;
  captures: { black: number; white: number };
  deadStones: { row: number; col: number }[];
  finalScore: ScoreResult | null;
  moveCount: number;
}
~~~

- 空点在运行时可用 `null`，哈希/调试串使用 `.`；黑白分别使用稳定 `B/W` 或枚举，跨层必须有显式转换。
- 位置哈希为逐行连接的 `B/W/.`，行间用 `/`；哈希必须包含宽、高和拓扑命名空间，防止不同形状碰撞。位置超级劫只比较棋子布局，不把轮次、提子数或停着写入位置键。
- 所有复制必须深拷贝 board、deadStones、历史和结果，外部不得取得可变内部数组引用。
- GoEngine 的撤销栈只保留最近 32 个权威状态；完整复盘不依赖撤销栈。

### 15.2 Match session

~~~ts
interface MatchSessionSnapshot {
  transport: "local" | "online";
  controllerByColor: Record<Color, "human" | "ai">; // online 时由 players 派生
  positionToken: string | null; // online snapshot 才要求
  game: GameStateV1;
  replay: ReplayV1;
  timeControl: TimeControlSnapshotV1 | null;
  identity: {
    role: "player" | "spectator" | "host";
    color: Color | null;
  };
  connection: null | { state: "connecting" | "connected" | "reconnecting" | "offline" };
}
~~~

- 所有五个侧栏、视图、声音、AI scheduler、复盘入口和快捷键只订阅这一份 snapshot。
- online `positionToken` 每次 snapshot 都从当前 `GoEngine` 的尺寸、拓扑、棋盘、行棋方、阶段、停着、提子、死子、最后一手和位置历史重新计算；这些字段变化时 token 必须变化。手数由 `expectedMoveCount` 单独校验；成员、聊天或仅时钟投影变化不要求改变 token。local 可为 `null` 并依赖本机任务 ID/引擎状态。
- MatchSession 的动作结果只有“被当前 adapter 确认的新 snapshot”或“结构化失败且 snapshot 不变”两种，禁止 UI 乐观改 board 后再尝试修补。
- controller 和 transport 是配置字段，不得被压成一个 `mode` 枚举持久化；兼容读取旧 mode 时只做一次确定映射，然后立即写成两个轴。

### 15.3 复盘对象

~~~ts
interface ReplayV1 {
  schemaVersion: 1;
  complete: boolean;
  base: {
    width: number;
    height: number;
    size?: number;
    topology: Topology;
    scoringRule: "chinese" | "japanese";
    komi: number;
    board: (Color | null)[][];
    currentPlayer: Color;
  };
  events: ReplayEvent[];
  outcome?: { reason:"timeout"; winner:Color; loser:Color; finishedAt:number };
}
~~~

事件类型至少包括 `play`、`pass`、`toggle_dead`、`resume_play`、`finish_scoring`、`resign`；联机可另记录 `confirm_score` 作为元事件。认输事件携带认输方颜色，并在重建时产生同一 `winner/loser/reason="resign"` 终局；在线公开 replay 也可以在顶层 outcome 表达同一终局，且不能因此增加虚构手数。每事件带执行颜色/点、动作后 phase、顺序号和可选时间。`complete=false` 表示从中盘快照开始，导出时写 `XCOMPLETE[0]`。

复盘帧由 `base + events[0..cursor)` 纯函数重建。视图模式、相机、播放速度、AI 建议、候选固定状态和聊天都不是 ReplayV1 的一部分；因此切视图或研究变化不会改变棋谱，也不会污染 SGF。认输可由 `resign` 事件或公开 replay 顶层只读 `outcome` 表达，导出 SGF 时都转换成标准根属性 `RE[*+R]` 而不是虚构一手棋；超时同样使用 outcome，并转换成 `RE[*+T]`。

### 15.4 房间持久状态与公开快照

Durable Object 私有状态使用 `schemaVersion: 1`，至少保存：

~~~ts
interface StoredRoomV1 {
  schemaVersion: 1;
  code: string;
  revision: number;
  moveCount: number;
  game: SerializedGame;
  members: StoredMember[];       // 含 tokenHash，不含明文 token
  receipts: CommandReceipt[];    // 最后 256 条
  scoreConfirmations: Color[];
  undoRequest: UndoRequest | null;
  timeControl: StoredTimeControlV1 | null;
  chatSequence: number;
  chatMessages: ChatMessage[];   // 最后100条且总计<=64KiB
  chatBucket: TokenBucket;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  expiredAt: number | null;
}
~~~

公开快照必须移除 `tokenHash`、成员限速桶、回执内部数据和连接 ID，只输出当前用户确有需要的信息。`revision` 对棋局/成员/设置更新单调递增；合法聊天只更新 `chatSequence` 和 TTL，不增加 `revision`。

恢复旧状态时：

- 先验证 `schemaVersion`、房间码、成员唯一性、颜色唯一性、维度、棋盘矩阵、token 哈希格式、时间和上限，再构建引擎。
- 缺失的新限速桶、`lastSequence` 或旧悔棋 request ID 以代码规定的安全值迁移；未知更高 schema 必须拒绝，不可猜测。
- 缺失 `timeControl` 的旧房间迁移为未计时；存在时必须验证版本、配置上限、两方非负剩余时间、活动方/锚点配对和超时结果一致性，损坏数据以 `BAD_ROOM_STATE` 拒绝，不能自行修补出额外时间。
- 棋局中同时存在冲突的 `size/width/height` 按第 3.4 节拒绝。
- 反序列化失败不得覆盖现有内存状态；记录不含私密内容的结构化错误，必要时将房间判定不可恢复。

### 15.5 浏览器本地状态

| key | 内容 | 生命周期 |
| --- | --- | --- |
| `3d-baduk-sound-enabled` | `true/false` | 用户设备长期偏好 |
| `3d-baduk-ai-model` | `b10/b18` | 用户设备长期偏好 |
| `bamboo-baduk-player-name` | 最近使用的名字 | 用户设备长期偏好 |
| `bamboo-baduk.session.{ROOM}` | 本人 token、身份、`nextSequence`；自动白席复用黑方房主身份，不另存 proxy session | 离开/过期前 |

- 本地棋局、AI 对局、聊天草稿、复盘光标和相机默认只存在内存，刷新即失；棋谱持久化通过 SGF 导出完成。
- 不把模型二进制复制进 localStorage/IndexedDB；依赖浏览器 HTTP 缓存。不得把 session token 放入可分享 URL、SGF、日志或错误遥测。
- 视图状态必须与逻辑状态分离：每种视图可保存自身平移/旋转/缩放，但切换棋盘尺寸或拓扑后按新几何安全重置。

## 16. 信息架构、视觉与响应式

### 16.1 页面骨架

应用是单页、深色、以棋盘为主的桌面/移动端界面：

~~~text
┌ 顶栏：3D Baduk | 拓扑切换 | 模式/连接状态 | 音效 ┐
├────────────────棋盘舞台────────────────┬────OGS 风格侧栏────┤
│ 当前 Flat / Arc / 3D Canvas            │ 黑方时钟卡          │
│ 视图切换、旋转/平移提示、高亮和 AI 候选 │ 白方时钟卡          │
│                                        │ 棋局 分析 聊天 棋谱 设置 │
│                                        │ 当前标签内容（可滚动） │
└────────────────────────────────────────┴───────────────────┘
~~~

顶部必须直接并列三个拓扑快捷按钮“竹筒 / 甜甜圈 / 莫比乌斯”，设置区也提供对应的三项详细选择；两处高亮和 `aria-pressed` 始终同步。产品名始终显示“3D Baduk”，不得恢复“桶围棋”；竹筒只是棋盘类型。

侧栏参考 OGS 的信息密度而不复制品牌：黑白棋手/时钟卡始终位于标签栏上方；下方固定五个标签“棋局 / 分析 / 聊天 / 棋谱 / 设置”。五个标签及其面板在 local/online、当前支持的 controller 组合和观战身份下必须是**同一组 DOM 节点**，只根据 match session snapshot 改内容、权限、disabled/hidden 子控件和提示；不得销毁本地侧栏再创建联机侧栏。一次只显示一个标签面板，隐藏面板不得占布局或进入键盘 Tab 顺序；标签切换不修改棋局、复盘光标、AI 请求或房间状态。

“设置”尤其只能有一份表单 DOM：拓扑、宽高、规则、贴目、计时、transport 和 controller 控件都从同一表单读写。`local` 可设置黑白全部组合；`online` 固定黑方真人，白方控件通过 `attach_ai/detach_ai` 在真人空席与自动 AI 间切换，AI 黑方/AI-AI 显示为未支持而不是伪装可用。其他设置由房主 `new_game` 提交；旁观者和非房主看到同一值但无权字段只读。切换 transport 不得丢失草稿、重复 ID/事件监听或造成两个互相不同步的隐藏表单。

### 16.2 控件与状态可见性

- 视图切换必须只显示当前拓扑支持的项：竹筒为“平面 / 弧面 / 立体”，甜甜圈与莫比乌斯为“平面 / 立体”。
- 当前拓扑、`W × H`、轮到谁、阶段、最后一手、双方提子数和连接状态在不打开设置时也可见。
- 有计时时，黑白时钟、当前活动方、主时间/读秒状态和超时结果不依赖当前侧栏标签，始终可见；无计时时时钟区明确显示“无计时”或安全折叠，不能显示伪造的 `00:00`。
- 落子按钮不单独存在；合法点击直接落子。停一手、悔棋、点目/恢复下棋、新局、复盘、导入/导出都有文字标签，不能只有图标。
- 悔棋按钮必须按 controller/身份显示动作语义：人类对自动 AI 为“直接悔棋”，在线真人对真人为“申请悔棋”，本地同设备或暂停的 AI 自对弈为“悔棋”。认输按钮使用“认输”并打开二次确认；旁观、复盘和纯 AI 自对弈不显示或禁用。
- 建立 match session、创建在线房间或以棋手/观众身份加入后，侧栏自动切回“棋局”，使停一手、悔棋和认输控件立即可见；之后可自由切换五个固定标签。
- 仅当当前颜色的 controller 是本设备可操作的人类且 session 允许落子时显示该颜色幽灵棋子；不是本人回合、AI 思考、在线未就绪、复盘、聊天选点时均不预览。不得再用旧的四模式枚举判断。
- 不合法点的点击不改变状态，并给出短暂、非模态原因；拖动结束不得误下棋。
- 任一颜色 controller 为 AI 时显示其模型、代理位置、加载阶段、思考状态、取消/重试。b18 旁必须常驻“高资源：约 93.4 MiB、仅 WebGPU、可能占用大量显存/内存”提示。
- 黑白 controller 都是 AI 时显示同一模型驱动、当前 transport、手数、播放/暂停；只有暂停时可悔一步。
- “分析”标签统一承载本地局势、观战局势和复盘 AI；候选按钮支持鼠标 hover、键盘 focus 与点击固定，并显示当前变化文本。
- 复盘模式使用“棋谱”标签中的独立工具条，清楚显示 `当前帧 / 总事件数`，并让用户在不退出复盘的情况下切换任何可用视图；进入复盘时自动暴露相关控件，但用户仍可切到“分析”查看该帧候选。
- “聊天”标签始终存在；local 显示联机引导，online 真人显示输入，online 自动 AI 对手显示其不会聊天的说明，旁观者显示只读历史。

### 16.3 视觉令牌

基准配色：

| 用途 | 颜色 |
| --- | --- |
| 页面暗底 | `#0b100f` |
| 面板 | `#131d1a` |
| 主强调 | `#d7a95b` |
| 高强调/焦点 | `#f0c477` |
| 危险/错误 | `#f08c7e` |
| 次要文字 | `#9eada7` |

棋盘保持温暖竹木色，线条和星位有足够对比；黑白棋子必须通过明暗、轮廓和高光同时区分，不能只靠颜色。最后一手、死子、AI 候选、聊天坐标使用不同形状/动画语义，且提供图例或提示，不能都使用同一种圆圈。

### 16.4 响应式

- 桌面：顶栏约 74 px，主区为弹性棋盘 + 约 350–390 px 侧栏，占满可用视口高度；侧栏自身滚动，时钟/标签导航尽量保持可见。
- `viewport <= 920 px`：棋盘和侧栏改为上下堆叠；棋盘最小高度 `min(68vh, 700px)`；设置字段允许两列。
- `viewport <= 560 px`：顶栏约 62 px；棋盘舞台约 `62vh`；设置字段改单列；聊天可见高度约 190 px；按钮加大触控间距。
- 横屏手机优先保证棋盘，侧栏允许内部滚动；不能让整个页面因 Canvas 固定宽度产生水平滚动条。
- Canvas 的 backing store 按设备像素比创建，但渲染 DPR 上限为 2；CSS 尺寸变化后更新相机、viewport 和命中测试。
- `ResizeObserver`/窗口 resize 后应保持逻辑中心和安全缩放；宽高变化时不能沿用旧棋盘的相机半径。

### 16.5 无障碍和键盘

- 所有原生控件有 `<label>` 或 `aria-label`，切换按钮使用 `aria-pressed`，状态/错误使用 `role=status/alert` 或合适的 live region。
- 键盘焦点使用至少 2 px 的高强调轮廓；不得仅靠浏览器默认在暗底上勉强可见。
- Tab 顺序按顶栏 → 棋盘工具 → 时钟 → 侧栏标签 → 当前标签内容；不被其他隐藏面板中的控件截获。AI 候选焦点应触发与 hover 相同的临时变化，Enter/Space 固定或取消固定。
- Esc 取消聊天选点、关闭弹层或停止当前拖动；Space 仅在焦点位于复盘播放按钮时播放/暂停，不劫持页面滚动。
- 尊重 `prefers-reduced-motion`：关闭自动滑动/自动旋转和非必要脉冲，缩短过渡；用户仍可手动操作。
- 所有图标和表情包有文本名称；声音不是动作成功的唯一反馈。
- **已知可访问性缺口（代码推导）**：当前 Canvas 棋点本身仅支持指针/触摸，尚未提供逐点键盘导航，因此不能宣称完整 WCAG 键盘可玩。复刻目标至少保证周边控制可键盘操作；若要关闭缺口，应增加可见行列焦点、方向键按拓扑邻接移动、Enter 落子和屏幕阅读器坐标/占用状态，且不能改变现有指针行为。

## 17. 模块边界与实现蓝图

完整复刻应保持以下依赖方向，具体文件名可变，但职责不得混杂：

~~~text
main/UI orchestration
 ├─ match/MatchSession ── localTransport | onlineTransport
 │    ├─ controllerByColor ── human input | AI scheduler
 │    └─ canonical snapshot/action reducer/positionToken
 ├─ game/goEngine ── topology helpers ── replay/SGF
 ├─ game/timeControl（纯函数；浏览器与 RoomEngine 共用）
 ├─ view/Flat, Arc, Cylinder, Torus, Mobius ── Three.js
 ├─ ai/mcts ── katago feature/model/worker ── TensorFlow.js
 ├─ multiplayer/roomClient + commandSync + protocol + chat
 └─ audio/gameSounds

worker/index ── BadukRoom Durable Object ── shared roomEngine/goEngine/timeControl/chat/protocol

scripts/release ── Git tag + Wrangler Version/Deployment + GitHub Release
~~~

### 17.1 核心模块契约

| 模块 | 只负责 | 不得负责 |
| --- | --- | --- |
| MatchSession | 唯一 live snapshot、统一业务动作、controller 调度、positionToken/stale 结果和 replay 覆盖协调 | 按“本地/AI/联机模式”复制 UI 或规则 |
| Transport adapters | local 直接提交 session engine；online 负责命令/ACK/snapshot 的等价映射 | 改变动作语义、控制器归属、侧栏 DOM 或围棋合法性 |
| Controller scheduler | 按颜色决定等待人类还是启动浏览器 AI；AI 结果绑定 positionToken | 持有第二份棋盘、替服务端裁决在线动作 |
| GoEngine | 棋盘、合法性、提子、阶段、点目、有限撤销 | DOM、相机、网络、声音 |
| topology helpers | 邻接/接缝和几何映射的纯函数 | 棋局阶段、UI 文案 |
| Replay | 事件记录、光标重建、播放控制输入 | 修改 live GameEngine |
| SGF | 安全解析/生成和 replay 映射 | HTML、文件上传服务器 |
| TimeControl | 配置验证、用时扣除、读秒切换、暂停/恢复、超时截止和快照投影 | DOM、网络身份或自行决定何时应运行 |
| View adapters | 绘制、命中测试、相机/平移状态、高亮 | 判定落子是否合法 |
| AI Worker | 模型加载、特征、候选、搜索和取消 | 直接改 UI 或权威房间 |
| RoomClient | REST/WS、重连、ACK、事件合并、token 存取 | 自行裁决联机棋步 |
| RoomEngine | 房间成员、权限、顺序、权威 GoEngine/时钟、TTL/聊天 | Cloudflare Request/Response 细节 |
| Worker router | 同源、限长、路由、DO 转发、静态资源 | 重复实现围棋规则 |
| Audio | Web Audio 解锁和两类合成音效 | 决定动作是否成功 |
| Release CLI | SemVer/tag 校验、质量门、部署标识核对、GitHub prerelease 和显式回滚 | 提交代码、合并 main、强推 tag 或猜测部署目标 |

### 17.2 渲染接口

所有视图实现同一最小接口：

~~~ts
interface BoardView {
  mount(container: HTMLElement): void;
  setBoard(state: GameStateV1): void;
  setInteractionPolicy(policy: InteractionPolicy): void;
  highlightPoint(row: number, col: number, options: HighlightOptions): void;
  clearHighlight(source?: string): void;
  focusPoint(row: number, col: number): void;
  resize(widthCssPx: number, heightCssPx: number, dpr: number): void;
  dispose(): void;
}
~~~

回调只报告 `{row,col,gesture}`，由 MatchSession 根据当前 snapshot、controller 权限和临时工具决定“落子 / 标死 / 插入聊天坐标 / 旁观本地分析点 / 复盘无动作”。视图不得缓存一份独立 board 后自行应用棋步。候选与变化作为只读 overlay 数据传入；切换视图时先销毁旧事件和 GPU 资源，再用同一个逻辑快照挂载新视图。

### 17.3 矩形实现禁区

以下是必须静态检查和测试的常见错误：

- 一维索引写成 `row * height + col`；正确为 `row * width + col`。
- 循环列时使用 `height`，或循环行时使用 `width`。
- Three.js 管段/主环段都从 `size` 读取。
- 相机距离只按宽度，导致高窄棋盘裁切。
- 聊天、SGF、AI 策略只带 `size`。
- 正方形 `size` 与权威 `width/height` 分歧时静默选一个。
- AI 先补成 19×19 却没有把输出映射回原 `H × W`。

### 17.4 生命周期与清理

- 切换 transport/controller 配置、新局、退出复盘或页面卸载必须取消旧 positionToken 的 AI 请求、自动播放 timer、时钟显示 interval、自动旋转 RAF、聊天高亮 timer、WebSocket 和不再使用的音频/Three.js 资源。仅更换 transport adapter，不得销毁并重建侧栏/设置 DOM；Durable Object 使用 alarm 而不是常驻 interval 裁决计时。
- 事件监听器使用可撤销引用或 AbortController；重复切换 100 次后一次点击只能触发一次动作。
- AI b10 与 b18 不并存于多个 Worker；切模型时先释放旧 Tensor/模型，AI 自对弈的黑白共用同一实例。
- WebGL context 丢失时显示可恢复提示并允许重建视图；不应清空逻辑棋局。

## 18. 安全、隐私、资源和故障语义

### 18.1 信任边界

所有以下数据均不可信：URL 房间码、HTTP/WS JSON、SGF、玩家名、聊天、localStorage、模型 HTTP 响应和旧 Durable Object 状态。要求：

- 先验证类型、范围、矩阵形状、枚举和大小，再修改状态；一个命令要么原子成功，要么完全不变。
- 服务端重新计算颜色、轮次、坐标合法性、聊天坐标和分数；客户端字段不能越权。
- `modelId`、`controllerId`、`expectedMoveCount`、`expectedPositionToken` 和“我是 AI”声明同样不可信。服务端只允许已认证黑方房主控制其持久化自动白席，并从当前状态重新计算 positionToken；该 token 只防异步陈旧结果，不能代替会话鉴权或命令幂等 ID。
- 服务端重新计算计时截止和超时结果，绝不接收客户端报告的剩余时间。在线棋手的公平竞赛限制在 UI 和分析调用入口双重执行；旁观者分析的候选、自选点和 PV 不进入任何网络 payload。
- token 不进入公开快照、URL、聊天、日志、SGF、错误消息或 analytics。
- 对比 token 哈希使用常量时间；随机源使用 Web Crypto，不使用 `Math.random()` 生成凭据。
- 所有用户文本以安全文本节点渲染；导入 SGF 也不插入 HTML。
- REST 和 WebSocket 执行同源限制。若未来开放跨域，必须改为明确 allowlist、CSRF/Origin 策略，不能使用 `*`。
- 推荐部署增加严格 CSP（只允许自身脚本/模型/Worker/WSS，按 TF.js/WebGPU 实测调整）、`X-Content-Type-Options: nosniff` 和合理 Referrer-Policy；这是加固目标，现有基线未宣称已完整配置。

### 18.2 资源预算

| 资源 | 边界/目标 |
| --- | --- |
| 可玩交叉点 | 最大 `25 × 25 = 625` |
| 撤销历史 | 32 状态 |
| SGF | 2 MiB、10,000 节点等第 12.5 节上限 |
| HTTP JSON | 4 KiB |
| 客户端 WS 消息 | 8 KiB |
| 连接 | 64/房间 |
| 自动 AI 席位 | 当前最多 1 个白席/房间；无独立连接或 session |
| 观战者 | 32/房间 |
| 未连接观战预约 | 60 秒 |
| 已连接观战者断线宽限 | 5 分钟 |
| 观战命令限流 | 单人 3 次突发/每 3 秒补 1；全房 8 次突发/每秒补 1 |
| 命令回执 | 256/房间 |
| 聊天 | 100 条且 64 KiB |
| b10 下载 | 11,138,361 bytes |
| b18 下载 | 97,898,094 bytes，分 4 片 |
| 渲染 DPR | 最大 2 |
| AI UI 候选/PV | 最多 5 个候选、每个最多 8 手变化（Worker 内部候选最多 25） |

- 服务端没有 AI CPU/GPU 压力，AI（包括观战分析）只消耗模型静态带宽和发起分析者的本机算力；静态资源应使用长缓存和内容哈希/固定校验。
- 首屏不能预加载 b18。只在用户明确选择并确认后下载；失败后回退 b10 或人工模式，不能循环重试耗流量。
- AI 推理在 Worker，主线程在一般桌面设备上交互长任务应小于 50 ms；加载/搜索期间棋盘旋转和平移仍需响应。
- 渲染循环仅在可见、动画或交互时持续；后台标签页暂停自动播放/旋转，并用 Page Visibility 恢复。
- Durable Object 每条命令只持久化一次最终状态；聊天增量广播不得强制发送全量大棋盘 state。

### 18.3 模型供应链

- KataGo 代码、网络文件和许可必须在 `THIRD_PARTY_NOTICES.md`、网络许可文件和 README 中保留来源与许可证说明。网络列表及许可可核对 [KataGo 官方仓库](https://github.com/lightvector/KataGo)、[KataGo Training 网络目录](https://katagotraining.org/networks/) 和 [网络许可](https://katagotraining.org/network_license/)。
- b10 gzip 和 b18 四片在构建/CI 中验证准确字节数和稳定哈希；任一分片缺失、顺序错误或哈希不符则模型不可用。
- 二进制解析必须检查头、层形状、张量数量和解压上限，不把损坏模型分配成无限内存。
- 不从用户可控 URL 加载模型；线上只允许发布包内的目录项。

### 18.4 错误分类和用户恢复

| 类别 | 示例 code | UI 行为 |
| --- | --- | --- |
| 输入 | `BAD_REQUEST`, `INVALID_CHAT` | 就地指出字段，保留其他输入 |
| 棋步 | `ILLEGAL_MOVE`, `STALE_GAME_STATE` | 不改棋盘，解释禁入/劫/轮次并同步 |
| 计时 | `GAME_TIMED_OUT`、非法计时配置 | 显示权威胜负/就地校验设置，不接受迟到棋步 |
| 权限 | `FORBIDDEN` | 禁用不属于该身份的动作 |
| 会话 | `MISSING_SESSION`, `SESSION_REPLACED` | 尝试恢复或要求重新加入；清除失效 token |
| 网络 | `ACK_TIMEOUT`, `DISCONNECTED` | 显示重连，保留幂等命令/草稿 |
| 房间 | `ROOM_NOT_FOUND`, `ROOM_EXPIRED`, `ROOM_FULL` | 回到建房/加入入口，不假装恢复 |
| 限速 | `CHAT_RATE_LIMITED` | 显示短倒计时，不丢正文 |
| AI | 模型下载/后端/内存/取消 | 保持棋局，允许重试 b10、换模式或取消 |
| SGF | `SgfError` + 位置 | 独立错误摘要，不改 live 棋局 |
| 图形 | WebGL/WebGPU context lost | 保持逻辑状态，重建或回退可用视图/模型 |

错误必须在上下文附近显示，同时写入一个简洁的全局状态区；可恢复错误不使用阻塞 alert。生产日志使用 code、房间码的不可逆摘要、版本和阶段，不记录正文、名字、token、整盘棋或模型张量。

### 18.5 浏览器支持

- 目标为当前稳定版 Chromium、Edge、Firefox、Safari 的桌面和移动浏览器。
- Three.js WebGL 是棋盘最低图形要求；不支持时显示明确不兼容页，仍可提供 SGF 导出（若已有内存棋局）。
- b10 后端顺序为 WebGPU → WebGL → CPU；b18 只允许 WebGPU。没有 WebGPU 时 b18 选项仍可见但禁用并解释原因。
- 浏览器阻止自动音频时，第一次用户手势后再创建/恢复 AudioContext；失败只静音，不阻断棋局。
- 页面可在 HTTPS 线上和 `localhost` 开发；WebGPU/Service Worker 等安全上下文能力不得用不安全公网 HTTP 规避。

## 19. 功能验收标准

以下条目是可观察的交付门槛。除注明人工视觉检查外，都应尽量自动化。

### 19.1 尺寸和拓扑

1. 新用户打开页面时，配置和实际引擎均为 19×19、竹筒、中国规则、7.5 贴目、弧面、b10。
2. 选择 9/13/19 快捷项时宽、高一起变化；手动设为 7×11 后没有快捷项保持选中。
3. 输入小于 5、大于 25、空值、小数、`NaN/Infinity` 时按第 3.1 节确定处理，服务端不能创建越界新局。
4. 对 7×11、11×7、5×25、25×5 棋盘，交叉点总数、board 形状、落子、聊天坐标、SGF 和 AI 索引均为 `W × H`，无裁切、错列或重复点。
5. 竹筒中 `(r,0)` 与 `(r,W-1)` 相邻，上下边不相邻；甜甜圈再令 `(0,c)` 与 `(H-1,c)` 相邻；莫比乌斯横接缝连接到反行，纵边仍有界。
6. 在每种接缝上构造跨缝棋块后，数气、提子、自杀、超级劫、死子选择和领地与统一邻接函数一致。
7. 每个逻辑棋点只出现一次；接缝用于相邻和重复展示时，点按任何视觉副本都映射到同一 `(row,col)`，不能落两子。
8. 切换拓扑必须新建棋局并确认；不得只换几何却保留按旧邻接形成的棋局。

### 19.2 视图和交互

1. 竹筒显示平面、120° 弧面、立体三种视图；甜甜圈和莫比乌斯显示平面、立体，不出现不可用弧面按钮。
2. 同一局在任何视图切换后棋子、最后一手、轮次、提子、阶段、死子和复盘光标完全相同。
3. 桌面端右键拖动平面与弧面进行循环滑动，右键拖动三维视图旋转；甜甜圈平面还可纵向和斜向循环滑动；触屏沿用单指拖动；拖过接缝连续、无空白断口。
4. 弧面手势表现为棋盘纹理沿弧面平移，不是把相机绕一个完整圆柱公转；自动滑动约 30 秒一圈，可关闭，手动拖动立即停止。
5. 三维视图旋转和缩放符合第 6 节；莫比乌斯跨扭转处网格、棋子法向和点按映射连续。
6. 将甜甜圈和莫比乌斯分别旋转一整圈，任何玩家可见侧的棋线、棋子和标记都清楚；补光随视角移动，不能因固定世界光源产生不可读暗面。
7. 小于 6 CSS px 且主指针以左键/轻点释放于同一点的动作才可落子；左键拖动、非主指针、右键、`pointercancel`、出界释放均不落子，且棋盘区域不弹出浏览器右键菜单。
8. 不是本人回合、AI 思考、联机未齐、复盘、聊天选点时点棋盘不能落子；其中只有聊天选点会把坐标插入草稿。
9. 7×11 和 11×7 在 360×640、920×700、1440×900 视口中完整可用，Canvas 命中点与视觉交叉点误差不超过该点间距的 25%。

### 19.3 围棋规则和结束流程

1. 空点落子、连接、提掉单块/多块、打劫、自杀和多接缝棋块均有单元测试。
2. 落子产生提子时先提对方再判断自杀；被提后获得气的棋合法。
3. 任一布局若在同拓扑历史中已出现则被位置超级劫拒绝；停着不因重复空棋盘被拒绝。
4. 两次连续停着进入 scoring；标记一个棋子会切换其整个连通块；恢复下棋清除死子和最终结果。
5. 中国面积与日本数目对同一人工局面按第 7 节分别得到可核算的黑白分、贴目和胜负。
6. 点目确认由 match session 按 controller/身份收集：在线真人双方各自确认；在线人机由黑方房主直接确认并由 DO 为其控制的自动白席补齐；任一死子变更清空确认。local 各组合使用同一评分结果。
7. 同设备悔棋正好回退一事件并恢复完整历史；人机“直接悔棋”在 local/online 都回到人类上次决策点，在线由 DO 原子执行；只有在线真人对真人显示“申请悔棋”，未经对方同意绝不回退。
8. 同设备当前人类颜色和人机中的人类方二次确认后能认输；在线真人席位不受轮次限制可认输且无需对手同意，DO 根据认证身份/controller 立即判定；旁观者、复盘和纯 AI 自对弈从 UI、session、adapter 与服务端均不能认输。

### 19.4 Match session、AI 和声音

1. transport 与 controllerByColor 是两个独立轴：local 的四种组合，以及 online 当前支持的 human-human、真人黑方/AI 白方，都使用一个 MatchSession、同一动作 reducer 和同一五标签/设置 DOM；不存在四套互斥 UI。online AI 黑方/AI-AI 明确标注未来扩展。
2. 切换 transport、local 新局 controller 或 online `attach_ai/detach_ai` 时，旧 AI、WebSocket/timer 和监听被取消，但侧栏标签、设置节点、表单值与无关视图偏好不被复制或丢失；重复切换 100 次仍一次点击只触发一个动作。
3. 人机只在合法人类动作被当前 transport 确认、snapshot 轮到 AI 且 positionToken 仍匹配后思考；等待期间人类不能代替 AI。悔棋、新局、重连或快照推进后，旧 token 的推理即使返回也不落子。
4. b10 首次加载显示约 10.6 MiB 说明并可按 WebGPU/WebGL/CPU 回退；b18 选择前显示约 93.4 MiB/高内存/仅 WebGPU确认，不支持时不下载。
5. 对每种拓扑和矩形测试盘，AI 返回合法点或 pass；候选策略不会指向 padding、已有棋子或映射错误的接缝点。
6. AI 自对弈只在 local 创建一个模型实例/Worker，黑白串行复用，默认两手间约 420 ms；暂停后无新手，恢复后继续，只有暂停时可悔一步。不得把 online AI-AI 列为已完成。
7. 在线黑方房主接入 KataGo 后，公开 `players` 自动出现带 `automated/modelId/controllerId` 的白席，前端由此派生 controller。房主仍用原会话发送 `ai_play/ai_pass`；命令带 expectedMoveCount/expectedPositionToken，伪造 controllerId、非房主、旧位置和错误回合均被拒绝，玩家与观众只看到一次权威落子。
8. AI 自对弈连续两次 pass 后自动暂停在 scoring；允许房主/本地观察者标记死子并确认、悔掉最后一手或恢复。未完成死活判定前不得自动冻结结果。
9. AI 复盘能分析当前帧和整局，显示最多五个候选并同步当前视图；每个候选最多八手 PV，hover/focus 临时预演、点击固定/取消固定；取消后 1 秒内不再增加结果，已完成结果保留。
10. 本地局面与观战局面可分析；进行中的在线真人棋手无法从按钮、键盘或直接函数入口开启辅助分析。观战者分析/自选合法点后，房间 revision、positionToken、棋盘、聊天和对手页面均完全不变。
11. 落子音只在 transport 确认权威动作成功后播放一次；一次动作提掉一颗或多颗都只播放一次提子音；重连 state、复盘跳帧和非法点击不重复播放。
12. 关闭声音立即生效并持久化；浏览器未解锁音频时不抛出阻断错误。

### 19.5 复盘与 SGF

1. 任意模式完成至少 20 手后进入复盘，可到开头、上一手、下一手、结尾，0.5×/1×/2×播放并暂停。
2. 在平面下出的棋可在三维逐手播放，三维下出的棋可在平面/弧面播放，切换视图不改变帧号。
3. 活棋局继续存在；退出复盘回到进入前 live 状态，复盘导航不能悔棋或向联机服务发命令。导入不同拓扑 SGF 时，三个拓扑按钮在复盘中高亮棋谱拓扑；退出后恢复 live 棋局拓扑的高亮和几何。
4. 竹筒、甜甜圈、莫比乌斯，正方形和矩形，落子/pass/标死/恢复/完成点目均可导出并重新导入到相同最终状态。
5. 正方形输出 `SZ[N]`，矩形输出 `SZ[W:H]`；停着输出空点；拓扑写 `XTOP`。
6. 标准 19×19 无扩展 SGF 可导入；缺 `XTOP` 时采用当前待选拓扑并显示明确警告；标准 `RE` 结果在复盘终点可见。
7. 多局、多变化 SGF 只播放第一局主分支并显示兼容警告摘要；恶意深树、2 MiB 超限、未结束属性和越界点安全失败，live 棋局不变。
8. 导出的普通落子可被一款外部 FF[4] 阅读器打开；外部软件对特殊接缝的规则差异在 UI/README 说明。
9. 黑/白超时导出分别为 `RE[W+T]` / `RE[B+T]`，重新导入可展示标准时间判负且不生成虚构棋步或目差。
10. 黑/白认输分别导出为 `RE[W+R]` / `RE[B+R]`；ReplayV1 和房间持久状态恢复后保持同一认输方、胜方和终局，SGF 中不生成虚构认输棋步。

### 19.6 在线房间

1. 黑方建房后得到 6 位无混淆码；白方用码加入；第三名玩家不能占颜色但可观战；即使白席空缺，用户点击“仅观战”也保持 spectator，不被自动分配颜色。
2. 两浏览器看到相同 `revision/moveCount/board/replay`；白方抢先、观战落子、错误轮次、越界和非法劫均由服务端拒绝且双方状态不变。
3. 同一落子信封发送两次只产生一手；ACK 丢失、断线、重连和重发后仍无重复。
4. 刷新后用本房 token 恢复原席；在第二标签页恢复时旧连接被替换；不同 token 不能冒充。
5. 断线时 UI 显示重连，按 500 ms→最多 10 s 退避；成功后以权威快照修正本地，未确认命令得到原回执。
6. 在线连续 pass、双方标死/确认、恢复下棋、悔棋申请/同意/拒绝/取消、任一棋手认输、新局和离开均在两个玩家及观战端一致。
7. 24 小时没有有效活动后 alarm 删除房间；过期连接收到明确事件，再加入返回不存在。
8. 4 KiB HTTP、8 KiB WS、64 连接、32 观战者和错误 Origin 的边界均有拒绝测试。
9. 无计时旧房间快照的 `timeControl` 为 `null`；5 分钟 + 3×20 秒等预设能随创建/新局同步，损坏或半套读秒配置原子拒绝。
10. 时钟等待双方到齐才启动，断线继续走，点目/缺席/悔棋协商暂停；落子先扣本方再切钟，读秒消耗与幸存周期复位准确，恢复持久状态不赠送时间。
11. 最终截止前 1 ms 可正常推进，恰好截止时由服务端/DO alarm 判负并拒绝棋步；所有玩家和观战者看到一致 `finished`、winner/loser、`GAME_TIMED_OUT`，房间 TTL alarm 仍保留。
12. 每个在线权威 snapshot 有 positionToken；用上一个 token/手数重放 `ai_play/ai_pass` 或 `direct_undo_ai_round` 返回 `STALE_GAME_STATE`，棋盘、时钟和 replay 不发生业务变化。
13. 在线黑方房主在空白席时 `attach_ai` 后，白席出现且另一真人不能抢席；刷新继续使用原黑方会话，无第二 proxy session。房主断线不暂停时钟，恢复时旧 AI 结果不能提交；`detach_ai` 释放白席。
14. 白 AI 应手、直接悔棋、点目、黑方认输和观战在玩家/观众端一致，服务端进程中没有模型或推理任务。在线 AI-AI 不属于本项验收。

### 19.7 聊天

1. 黑方发送含中文、英文、换行和 Emoji 的正文，服务端原样保留规范化后的文字；不会因敏感词或立场被替换。
2. 白方发送每一个固定表情包，双方和观战者都显示正确 emoji、文案、棋色和发送者。
3. `D4`、`看 d 4 这里` 可提取，重复只留一次，`BAD4` 不提取，`I9` 和超范围点不提取，最多 4 点。
4. 点击当前局坐标会在 Flat/Arc/3D 对应同一逻辑点高亮 8 秒而不落子；新局宽高或拓扑不同后旧坐标禁用。
5. “棋盘选点”下一次点击只插入草稿，取消后恢复正常落子；该模式和落子预览不同时生效。
6. 301 code point、1,501 UTF-8 byte、5 行、空白消息、未知表情包被拒绝且不广播。
7. 第 6 个瞬发成员消息和共享桶超限返回限速；等待补充后可继续；观战者刷请求不会耗尽玩家共享桶。
8. 重连/重复信封不生成重复聊天；聊天到达不需要棋局 revision 变化，双方最终历史顺序相同。
9. 第 101 条或总量超过 64 KiB 时最旧消息删除；刷新恢复保留剩余历史，房间到期全部删除。
10. 输入 `<img onerror=...>`、`<script>`、恶意名字和 SGF 字符串只显示为文本，不执行；服务端忽略客户端伪造的 sender/color/points/time。

### 19.8 响应式与可访问性

1. 360 px 宽触屏上可以建房、落子、停着、聊天、选表情、切视图、复盘，无横向页面溢出；关键按钮至少 44×44 CSS px。
2. 除 Canvas 棋点这一已知缺口外，全部控件可只用键盘操作，焦点清晰，隐藏控件不进 Tab 序。
3. 屏幕阅读器可获知轮次、连接、AI 状态、错误、新聊天和表情包标签，且不会在每次 state 时重复朗读整个聊天室。
4. 开启 reduced motion 后无自动滑动/旋转/持续脉冲；手动拖动、播放控制和信息反馈仍可用。
5. 200% 浏览器缩放后文字和控制不被 Canvas 遮挡，侧栏可滚动且焦点项能滚入视图。
6. 桌面与移动端都能在“棋局/分析/聊天/棋谱/设置”间切换，黑白时钟不因切标签消失；隐藏标签内容不进入 Tab 顺序，候选 hover 与键盘 focus 行为一致。

## 20. 测试策略和覆盖矩阵

### 20.1 自动测试层级

1. **纯单元测试**：拓扑邻接、规则、点目、坐标、SGF parser、聊天规范化、计时/日式读秒纯函数、几何映射、AI padding/索引和候选/PV 归一化。
2. **状态机/属性测试**：随机合法棋序列的撤销-重放等价；每点邻接对称、无越界、度数符合拓扑；棋局/时钟序列化-反序列化等价。
3. **房间集成测试**：内存 RoomEngine + 假 WebSocket/fetch，覆盖真人/自动白席、黑方房主 controllerId、`attach_ai/detach_ai`、`ai_play/ai_pass`、手数/token stale 拒绝、幂等、重连、直接/协商悔棋、点目、聊天、权威超时、alarm、TTL 和回滚恢复。
4. **浏览器交互测试**：真实 Canvas pointer/touch、拖动阈值、resize、侧栏/时钟、transport × 已支持 controller 组合、唯一 DOM、聊天本地引导、房主浏览器自动白方、观战本地分析、候选 hover/focus/pin、视图切换和 reduced motion。现有 Node 测试不能替代这一层。
5. **线上 smoke**：对已部署 Worker 分别建立真人房和“真人黑方 + AI 白方”房；连接玩家/观战端，验证原黑方会话的 AI 命令、positionToken/手数、落子、直接与协商悔棋、计时快照/超时、点目、聊天、pass/状态一致、房主断线恢复和离开。
6. **人工视觉/性能测试**：三种曲面接缝、极端矩形、移动端、b18 显存压力和长局资源清理。

### 20.2 必测组合

为控制组合数，核心规则跑全笛卡尔积，视觉/端到端使用成对覆盖：

| 维度集合 | 拓扑 | 规则测试 | 视图测试 | AI 合法性 |
| --- | --- | --- | --- | --- |
| 5×5、9×9、13×13、19×19、25×25 | 三种 | 全部 | 每拓扑全部可用视图 | b10 全部 |
| 7×11、11×7 | 三种 | 全部 | 每拓扑全部可用视图 | b10 全部，b18 抽样 |
| 5×25、25×5 | 三种 | 邻接/提子/点目/SGF | Flat + 各自 3D | padding/合法性 |

两个轴的组合覆盖（`H/AI` 同时覆盖人类执黑与执白）：

| 场景 | local H/H | local H/AI 或 AI/H | local AI/AI | online H/H | online 真人黑/AI 白 | online 观战 |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| 权威动作路径 | local adapter | local adapter | local adapter | DO command | 房主原会话 + `ai_play/ai_pass` | 只读 snapshot |
| 落子/提子/pass/结束 | ✓ | ✓ | ✓ | ✓ | ✓ | 只读观察 |
| 悔棋 | 直接一手 | 直接到人类决策点 | 暂停后直接一手 | 真人协商 | `direct_undo_ai_round` | 禁止 |
| 点目确认 | 同设备补齐 | 人类直接 | 暂停后人工 | 双方确认 | 黑方确认，DO 补白方 | 只读 |
| 认输 | 当前人类颜色 | 始终人类方 | 禁止 | 任一真人席位 | 真人黑方 | 禁止 |
| 复盘/切视图/SGF | ✓ | ✓ | ✓ | ✓ | ✓ | 公开 replay |
| 聊天标签 | 联机引导 | 联机引导 | 联机引导 | 真人可发 | 黑方可发、AI 不发 | 只读 |
| 主时间/读秒 | 本地权威 | 本地权威 | 暂停联动 | DO 权威 | DO 权威，房主断线不停 | 只读显示 |
| 实时 AI 局势分析 | ✓ | ✓ | 暂停后 | 进行中棋手禁用 | 进行中黑方禁辅助分析 | 本地可用且不广播 |
| 五标签和设置 DOM | 同一组 | 同一组 | 同一组 | 同一组 | 同一组 | 同一组只读/按权限提示 |

online AI 黑方和 online AI-AI 仅是两个轴未来可扩展出的组合，当前矩阵故意不列为可用场景。

### 20.3 现有测试文件与新增责任

复刻项目至少保留等价覆盖：

- `goEngine.test.js`：规则、超级劫、点目、阶段、撤销。
- `mobiusTopology.test.js`、`mobiusGeometry.test.js`、`torusGeometry.test.js`：接缝邻接、参数化和命中映射。
- `rectangularBoards.test.js`：宽高分离、极端矩形、所有视图。
- `replay.test.js`、`replayReview.test.js`：帧重建、播放、最多五候选/八手 PV、交互状态和 AI 复盘。
- `sgf.test.js`：FF[4]、矩形、扩展、超时 `RE[*+T]`、警告和资源边界。
- `timeControl.test.js`：无计时兼容、主时间扣除、日式读秒周期、精确截止、暂停/恢复、持久化和快照投影。
- `aiMcts.test.js`、`aiTactics.test.js`、`aiNeuralPuct.test.js`、`katagoHybrid.test.js`：搜索策略、合法候选和有界 PV。
- `katagoTopologyPadding.test.js`、`katagoWorkerRuntime.test.js`：三种拓扑的每层 padding、矩形索引、取消和 Worker 消息。
- `aiModelCatalog.test.js`、`aiModelAssets.test.js`：目录、大小、分片、后端能力和许可。
- `matchSession.test.js`、`aiMatchMode.test.js`：两个正交轴、当前支持矩阵、统一动作路由、positionToken、local 单 Worker 自对弈暂停/恢复/悔棋/双 pass；测试明确拒绝把 online AI-AI 当成已支持。
- `gameSounds.test.js`、`movePreviewPolicy.test.js`：声音恰一次和幽灵棋策略。
- `protocol.test.js`、`commandSync.test.js`、`roomClient.test.js`、`roomEngine.test.js`：协议、幂等、positionToken/expectedMoveCount、真人/自动白席与 controllerId、房主授权的 `ai_play/ai_pass`、重连、直接/协商悔棋、显式观战权限、服务端计时、alarm、TTL 和旧版本回滚。
- `chat.test.js`：Unicode、坐标、表情、限速、历史、XSS 数据形状和矩形元数据。
- `scripts/release.test.mjs`：SemVer、受保护分支、脏工作树、tag/commit 冲突、Cloudflare 版本/部署解析和回滚安全门。

必须补充真实浏览器测试文件或等价方案，专门回归两组缺口：其一是主指针、左键落子、左键拖动不落子也不浏览、右键平移/旋转但不落子、右键菜单抑制、6 px 阈值、`pointercancel`、触摸滚动冲突、Canvas resize 命中、弧面滑动和坐标按钮聚焦；其二是切换 local/online 与当前支持 controller 组合后五标签和设置仍为同一 DOM 节点、监听不重复、local 聊天显示联机提示、房主只在新 positionToken/手数上调度自动白方，且直接悔棋/点目/时钟均由当前 adapter 确认。不能用更多纯函数测试声称已解决。

### 20.4 质量门槛

- `npm test` 全绿且无未处理 Promise rejection、Tensor/Worker 泄漏警告。
- `npm run build` 无错误；输出不引用开发地址，不把 source map、token 或本地绝对路径意外公开。
- `git diff --check` 无空白错误；第三方资产哈希/大小检查通过。
- `npm run test:release` 与 `npm run release:check -- <version>` 通过；发布前工作区干净、版本清单与命令参数一致，且当前分支不是 `main/master`。
- 关键纯逻辑建议以分支覆盖为门槛，但不能为追数字跳过几何/浏览器测试；规则、协议、SGF、聊天安全边界必须 100% 覆盖每个错误分支。
- 对一盘 625 点、至少 500 手的随机合法 replay 连续切换视图/拖动/复盘 30 分钟，不出现单调增长的 Worker、WebGL context、事件监听器或 timer。

## 21. 构建、部署和交付

### 21.1 环境和命令

要求 Node.js `>=22.0.0`。从干净检出开始：

~~~powershell
npm ci
npm test
npm run build
~~~

开发命令：

| 命令 | 行为 |
| --- | --- |
| `npm run dev` | 等同 `dev:online`，先构建再以 Wrangler 在 8787 提供完整联机环境 |
| `npm run dev:ui` | 仅 Vite UI；房间 API 不可用，适合本地规则/视图 |
| `npm run preview` | 预览静态构建；同样不提供 Durable Object |
| `npm test` | Node test runner 全套测试 |
| `npm run test:live -- <URL>` | 对已部署网址执行真实房间 smoke |
| `npm run deploy` | 构建后执行 `wrangler deploy` |
| `npm run release:version -- <semver>` | 只更新 `public/version.json`，不提交、不部署 |
| `npm run release:plan -- <semver>` | 只读显示版本/tag/渠道计划，允许脏工作树 |
| `npm run release:check -- <semver>` | 检查分支/版本/工作树并运行测试、构建和 Wrangler strict dry-run |
| `npm run release:publish -- <semver>` | 从当前非保护分支发布可审计版本、推 tag、部署并创建 GitHub Release |
| `npm run release:list [-- --json]` | 并列查看 GitHub Releases、Worker Versions 和 Deployments |
| `npm run release:rollback -- <tag-or-version-id> --yes` | 把生产流量回滚到已核实的不可变 Worker Version |

在企业代理/Windows 证书环境中，如 npm/Wrangler 出现 TLS 错误，可使用系统 CA：

~~~powershell
$env:NODE_OPTIONS='--use-system-ca'
npm ci
npm run build
$env:NODE_USE_SYSTEM_CA='1'
npm run deploy
~~~

这只是环境兼容方式，不能关闭 TLS 校验或把凭据写入仓库。

### 21.2 Cloudflare 配置

规范配置：

~~~text
worker name       = bamboo-baduk
main              = worker/index.js
compatibility     = 2026-07-01
assets directory  = dist
SPA fallback      = enabled
run worker first  = /api/*
DO binding        = BADUK_ROOMS -> BadukRoom
SQLite migration  = v1
observability     = enabled
workers.dev       = enabled
~~~

部署前必须确认 Wrangler 登录的是预期账户。不得猜测 workers.dev 子域；从部署输出读取真实 URL。目标公开地址为 <https://bamboo-baduk.pystashell.workers.dev/>。

### 21.3 部署前检查

1. 工作树只包含本次有意交付的文件，未提交模型分片不能被 `.gitignore` 漏掉。
2. b10、b18 四片、`KATAGO_NETWORK_LICENSE.txt`、`THIRD_PARTY_NOTICES.md` 都进入静态构建或可公开访问位置。
3. `npm test`、`npm run build`、模型校验、SGF 恶意输入和聊天安全测试通过。
4. 本地 `npm run dev` 完成两客户端建房、落子、聊天、断线重连。
5. `wrangler.jsonc` 的 Worker 名、DO binding、迁移和静态目录与本节一致。
6. 不提交 `.dev.vars`、token、Cloudflare 凭据、聊天样本私密数据、浏览器缓存或构建临时文件。
7. 正式发布使用干净的非 `main/master` 分支；`public/version.json`、目标 SemVer/tag 和待发布 commit 已核对，`release:check` 全绿。

### 21.4 部署后验证

部署成功不等于交付成功。必须验证：

1. 打开真实 URL 得到最新页面标题“3D Baduk”，默认配置正确。
2. `GET /api/rooms/health` 返回 200，`GET /version.json` 返回本次 SemVer，页面侧栏显示同一版本。
3. b10 和 b18 四个分片均返回 200、正确 MIME/长度、可缓存；不存在大于平台单文件上限的合并 b18。
4. 运行：

   ~~~powershell
   npm run test:live -- https://bamboo-baduk.pystashell.workers.dev/
   ~~~

   smoke 至少验证两个真实 WS 使用 `bamboo-baduk-v2`、双方状态一致、未审查 Unicode 正文及其 `D4` 权威坐标、固定表情包、计时快照、pass 和离开。
5. 用至少三个实际浏览器标签页人工验证黑/白/显式观战、重连、时钟切换、聊天坐标高亮、观战本地 AI 选点不影响玩家、Flat↔3D 多候选复盘和移动端侧栏。
6. 核对 GitHub Release 的 tag/commit/Worker Version ID/Deployment ID 与 Wrangler 100% 部署一致，记录验证时间和 smoke 摘要；失败时不宣称线上已更新。
7. 在不影响当前生产版本的前提下验证 `release:list` 能解析刚发布版本；回滚命令至少以解析/测试覆盖验证，真正生产回滚只在明确需要时执行。

### 21.5 版本化发布与回滚

每次面向用户的部署都必须形成一次版本化发布，而不是只运行裸 `wrangler deploy`。一次发布绑定四个可核对标识：

1. `public/version.json` 中严格 SemVer（页面显示、`/version.json` 可读取）；
2. 指向唯一完整 Git commit 的 annotated Git tag `v<semver>`；
3. 不可变 Cloudflare Worker Version ID（回滚目标）；
4. 本次生产流量切换的 Cloudflare Deployment ID。

GitHub Release 正文记录版本、tag、来源分支、完整 commit 和两个 Cloudflare ID。含 `-rc.N`、`-beta.N` 等后缀的 SemVer 自动创建 prerelease；稳定 SemVer 创建正式 release。

安全门：

- `release:version/plan/check/publish` 拒绝 `main`、`master` 和 detached HEAD；发布脚本不提交代码、不合并 main。`publish` 要求工作树干净且 `version.json` 与参数一致。
- 已存在 tag 只有在本地、远程都指向当前完整 commit 时才可安全重试；任何同名异 commit、多版本同 tag 或标识冲突都停止，绝不强推/改写 tag。
- 发布固定先运行 `npm test`、`npm run build`、`npm run deploy -- --dry-run --strict`，再推 annotated tag、以 tag/message 部署 Worker、核对 Version/Deployment JSON 中目标获得 100% 流量，最后创建 GitHub Release。
- 网络中断后只能在同一 commit 重新执行同一版本；脚本可复用 tag/commit 都匹配的 100% 部署，不得凭时间或“最新一条”猜测。
- 回滚是显式应急动作，必须先 `release:list` 核对目标并提供 `--yes`。tag 可解析到 GitHub Release 正文记录的 Worker Version ID；更旧目标直接使用 UUID。执行 `wrangler rollback` 后重新读取 deployments，只有目标版本获得 100% 流量并得到新的 Deployment ID 才报告成功。
- 回滚不移动 Git tag、不改 commit、不删除 GitHub Release；若目标本来已是 100% 当前部署，则幂等返回，避免制造无意义部署。

标准 PowerShell 流程：

~~~powershell
npm.cmd run release:version -- 0.2.0-rc.1
# 评审并提交 version.json 与本次功能
npm.cmd run release:check -- 0.2.0-rc.1
npm.cmd run release:publish -- 0.2.0-rc.1
npm.cmd run release:list
# 必要时：
npm.cmd run release:rollback -- v0.2.0-rc.1 --yes
~~~

`.github/workflows/release.yml` 提供带确认词 `RELEASE` 的手动等价流程，并从 `production` environment 读取 Cloudflare 凭据；本地与 CI 必须调用同一发布 CLI。由于 GitHub 通常只识别默认分支上的 `workflow_dispatch`，功能分支尚未合并时使用本地流程，不能为了发布偷合并 main。详细运维手册见 `docs/RELEASES.md`。

### 21.6 GitHub 交付面

- 代码仓库为 [pystashell/bamboo-cylinder-baduk](https://github.com/pystashell/bamboo-cylinder-baduk)。历史仓库名可保留，但页面产品名和 README 标题使用 3D Baduk。
- README 首屏和 GitHub About 的 homepage 必须包含可直接玩的线上 URL；仓库 description 应说明“异形拓扑的 3D 围棋，支持竹筒/甜甜圈/莫比乌斯、浏览器 KataGo、联机与复盘”。
- README 必须包含：玩法/拓扑、Flat/Arc/3D、矩形尺寸、主时间/读秒、侧栏/观战、规则差异、AI 本地资源与公平限制、在线隐私/聊天 TTL、SGF 扩展、版本/回滚、开发/测试/部署、第三方许可。
- 交付提交不得重写或丢弃他人未相关修改；提交作者信息使用用户认可的公开/noreply 身份。推送后核对远端 commit，而非只看本地成功。

## 22. 兼容性、已知约束和待验证项

### 22.1 必须保留的兼容行为

- 旧 `size=N` 状态迁移为正方形 `width=height=N`；新正方形仍附带 `size`，矩形永不附带。
- 旧 WebSocket 名能被识别并得到升级提示，但不能加入 v2 房间。
- 旧引擎缺省 `19/Japanese/6.5/cylinder` 仅用于读取缺字段旧数据；新用户默认是 `19/Chinese/7.5/cylinder`。
- 普通 SGF 不含 `XTOP` 时由用户确认当前拓扑；标准方形 `SZ[N]`、矩形 `SZ[W:H]` 必须保留。
- 正方形聊天历史只含 `boardSize` 时可迁移为等宽高；新消息始终写宽、高。
- 现有房间状态 `schemaVersion:1` 新增可缺省字段只能安全填充；有破坏性变化必须升 schema 和迁移，不得原地改变含义。
- 在线认输使用可缺省的房间级 `resignationOutcome`，底层 `game` 同时保存为上一版本可读取的已终局状态；回滚到不认识该字段的版本时房间仍可打开且保持终局，重新升级后恢复认输标签。对外 replay 必须隐藏兼容层的内部停着/点目事件，不增加玩家看到的手数。
- 自动白席通过成员上的可缺省 `automated/modelId/controllerId` 持久化，不使用顶层 controllerByColor 或 proxy 凭据。回滚到不认识这些字段的版本时房间仍可读取为已有黑白席位；旧版不会运行 AI，权威时钟按原规则继续，不能由服务端临时接管推理。
- 重新升级时从当前持久成员派生 controller。若回滚期间旧版释放并重新填入黑席而保留了白席的未知 automation 字段，恢复器把 `controllerId` 安全重绑到当前真人黑方；当前没有真人黑方时任何人都无权发送 AI 命令。旧版建立新局可继续保留自动白席，但旧认输辅助结果必须按其独立兼容指纹清理，覆盖 play、scoring 和 finished。
- `positionToken` 是从当前权威状态重新计算的并发令牌，不作为长期秘密或跨版本真相持久化。部署或回滚后的第一次 snapshot 必须发新 token；升级前仍在运行的 AI Worker 返回结果时必然因 token 不匹配而被丢弃/拒绝。
- 在线直接悔棋、点目和 AI 落子落盘后都只是普通 GoEngine/Replay/TimeControl 状态；回滚版本即使不提供对应 UI，也必须能够读取结果且不得再次执行已经 ACK 的命令。

### 22.2 已知产品/规则约束

- 特殊拓扑策略网络来自普通平面围棋训练，采用拓扑 padding 适配，不是专门训练；强度和“人类几段”没有可信标定。
- 当前混合 AI 的胜率/目差和 PV 是拓扑感知短搜索的启发式量，不等同完整原生 KataGo analysis engine；多候选表示“本次预算下优先研究”，不是精确全局排序。
- 中国/日本计分提供核心可玩闭环，不覆盖所有协会死活、劫材和无胜负判例。
- 已支持可选主时间、日式读秒与认输，但没有加秒制、加拿大读秒、让子、账号、匹配或云棋谱；实现者不得暗中加入会改变协议/隐私的新系统。
- Three.js 曲面是拓扑可视化。环面可以在 3D 嵌入；莫比乌斯是单面有边曲面；竹筒上下仍有边。UI 不得用“所有地方完全无边界”描述竹筒或莫比乌斯。
- Canvas 棋点目前存在键盘可访问性缺口，见 16.5；这要明确披露，不能用周边按钮可访问代替完整声明。

### 22.3 代码推导且需回归确认的值

以下值来自当前实现，而非最初口头需求；复刻时作为本规范默认。如产品负责人另行决定，必须同时更新代码、测试和本文：

- 弧面跨度 120°；自动滑动约 30 秒/周；拖动阈值 6 CSS px；渲染 DPR 上限 2。
- 撤销栈 32；AI 自对弈落子间隔约 420 ms。
- 正式 AI 搜索 `1400 ms / 800 iterations / rollout 16 / candidates 24`；复盘预算见 11.6。
- UI 最多显示 5 个 AI 候选、每条 PV 最多 8 手；Worker 候选硬上限 25。计时预设和字段边界见 9.5。
- 房间 TTL 24 h、32 观战、64 连接、256 回执；HTTP 4 KiB、WS 8 KiB。
- 重连 `500 ms ×2`、最大 10 s、±20%、10 次；ACK 12 s。
- 聊天 300 code point、1,500 byte、4 行、4 坐标、100 条/64 KiB及第 14.2 节限速。
- 响应式断点 920/560 px；桌面侧栏约 350–390 px；移动聊天区约 190 px。

发布前需要用实际 Chrome/Edge/Firefox/Safari 回归 WebGPU TF.js、b18 峰值显存和移动端 WebGL context；硬件差异无法只由单元测试确定。没有实测数据时必须标注“未验证”，不能承诺具体 FPS、内存或段位。

## 23. 实施顺序与最终完成定义

推荐按依赖顺序复刻：

1. 实现矩形 GameEngine、三拓扑统一邻接、规则和状态序列化，并以纯测试锁定。
2. 实现 Replay/SGF，再建立唯一 MatchSession、统一动作 reducer、positionToken 和 local transport adapter，使后续组合共享同一事件源。
3. 实现 Flat/Arc/三类 3D 视图及统一命中接口，再完成手势和响应式；视图只接 MatchSession snapshot。
4. 实现 controllerByColor、人类输入和 KataGo scheduler；完成三拓扑 feature padding、b10/b18、AI 自对弈、局势分析和多候选 PV 复盘。
5. 实现可序列化的主时间/日式读秒纯函数，接入 MatchSession，并让 local adapter 与在线 RoomEngine/alarm 分别承担各自 transport 的权威时间来源。
6. 实现 online transport adapter、RoomEngine/协议/RoomClient/Cloudflare Durable Object，再接真人席位、房主控制的自动白席、`attach_ai/detach_ai/ai_play/ai_pass`、显式观战、直接/协商悔棋和点目。
7. 在唯一五标签/设置 DOM 中接入所有 transport/controller 状态；在权威聊天状态上实现文字、表情包、坐标、限速和观战只读，local 聊天显示联机引导；在本地副本上实现观战分析并证明零广播。
8. 完成 controller/transport 切换资源清理、旧版本回滚迁移、浏览器端到端和真人房/真人黑方-AI白方房线上 smoke；online AI-AI 留作未来扩展。
9. 完成许可、README/GitHub About、版本化 prerelease/回滚、部署、真实 URL 验证和可访问性披露。

只有同时满足以下条件才可以称为完成：

- 本文第 19 节所有适用验收通过，第 20 节自动/浏览器/线上层级都有证据。
- 同一棋局能在所有适用视图无损切换和完整复盘，所有规则层都使用同一拓扑邻接。
- 矩形、SGF（含超时与认输结果）、b10/b18、local 四种 controller 组合、online 真人房与真人黑方/AI白方、房主授权 AI 命令/positionToken、本地 AI 自对弈、多候选 PV、主时间/日式读秒、显式观战、本地观战分析、直接/协商悔棋、认输、点目和聊天文字/表情/坐标在真实部署可用。
- 没有 token/XSS/越权/重复命令/无限输入等已知高风险缺口，第三方许可证完整。
- README 和 GitHub About 给出真实可玩地址；远端 commit、SemVer tag、GitHub Release、Worker Version 与 Deployment ID 可双向追溯，并能按文档安全回滚。
- 所有“未验证”项被明确列出；不得用模拟/本地结果代替线上和真实浏览器结论。
