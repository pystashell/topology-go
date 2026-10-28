// Dynamic copy keeps the Chinese UI sentence as the stable source key. This
// lets every local/online/AI renderer share one code path while the i18n layer
// chooses what each browser displays.
export const ENGLISH_DYNAMIC = Object.freeze({
  // Rooms that close by themselves (worker/BadukRoom.js, src/main.js, src/app/myGames.js).
  "对局中断，不计胜负": "Interrupted: no result",
  "房间已经关闭。": "The room has closed.",
  "这个房间已经关闭。": "This room has closed.",
  "棋手都离开了，房间已经关闭。": "The players left, so the room has closed.",
  "双方离开超过 30 分钟，这盘棋按中断保存，房间已经关闭。":
    "Both players were away for over 30 minutes: the game was saved as interrupted and the room has closed.",
  "房间已经关闭；这盘棋可以接着回看。": "The room has closed; you can keep replaying this game.",
  "房间已经建立。请在棋盘设置中确认配置并发起对局；对手进来之前请留在这个页面，离开超过 2 分钟房间会关闭。":
    "The room is ready. Confirm the setup under Board settings and start a game; stay on this page until your opponent arrives, as the room closes 2 minutes after you leave.",
  // Accounts (src/app/account.js).
  "你的账号": "Your account",
  "没有填邮箱": "No email",
  "注册后可以在账号设置里绑定邮箱：忘了密码时可以用它收验证码登录。":
    "After registering you can add an email in account settings; if you forget your password, you can sign in with a code sent to it.",
  "用户名和密码": "Username and password",
  "修改密码": "Change password",
  "还没有密码": "No password yet",
  "邮箱验证码": "Email code",
  "还没有绑定邮箱": "No email yet",
  "绑定邮箱": "Add email",
  "Google 账号": "Google account",
  "解绑": "Unbind",
  "确认解绑": "Confirm unbind",
  "已解绑这个 Google 账号。": "That Google account was unbound.",
  "请输入你的用户名，确认要删除这个账号。": "Type your username to confirm deleting this account.",
  "暂时无法删除账号，请稍后再试。": "The account cannot be deleted right now. Try again shortly.",
  "账号已删除。": "The account was deleted.",
  "Google 账号已绑定。": "The Google account is bound.",
  "这个 Google 账号已经绑定在另一个账号上了。先在那个账号里解绑，或者直接用它登录那个账号。":
    "That Google account is already bound to another account. Unbind it there first, or use it to sign in to that account.",
  "绑定 Google 没有完成，请再试一次。": "Binding the Google account did not finish. Please try again.",
  "暂时无法修改用户名，请稍后再试。": "The username cannot be changed right now. Try again shortly.",
  "暂时不能绑定 Google 账号。": "A Google account cannot be bound right now.",
  "暂时无法解绑，请稍后再试。": "It cannot be unbound right now. Try again shortly.",
  "已设置": "Set",
  "还没有密码（只能用邮箱验证码或 Google 登录）": "None yet (sign in with an email code or Google)",
  "还没有填邮箱。填一个并收验证码确认后，忘了密码时可以用它登录。":
    "No email yet. Add one and confirm it with a code; then you can sign in with it if you forget your password.",
  "你的账号还没有密码。设好以后也可以用用户名和密码登录；其他设备上的登录会退出。":
    "Your account has no password yet. Once set you can also sign in with your username and password; other devices are signed out.",
  "更换邮箱": "Change email",
  "验证邮箱": "Confirm email",
  "设置密码": "Set a password",
  "设好以后也可以用用户名和密码登录。改好后，其他设备上的登录会退出。":
    "Once set you can also sign in with your username and password. Other devices are then signed out.",
  "需要当前密码。忘了的话，先退出，再用邮箱验证码登录：登录后 10 分钟内可以直接设新密码。":
    "Your current password is needed. Forgot it? Sign out and sign in with an email code: for 10 minutes after that you can set a new one directly.",
  "你刚登录，可以直接设新密码。改好后，其他设备上的登录会退出。":
    "You just signed in, so you can set a new password directly. Other devices are then signed out.",
  "建议填邮箱：忘了密码时可以用它收验证码登录，登录后再设新密码。":
    "An email is recommended: if you forget your password you can sign in with a code sent to it and then set a new one.",
  "邮箱验证码登录": "Sign in with an email code",
  "第一次用 Google 登录，会自动注册一个账号。": "The first time you sign in with Google, an account is made for you.",
  "第一次用邮箱验证码登录，会自动注册一个账号。": "The first time you sign in with an email code, an account is made for you.",
  "填账号的邮箱，我们发一个 6 位数验证码，10 分钟内有效。登录后可以直接设新密码。":
    "Enter your account's email and we send a 6-digit code, valid for 10 minutes. Once signed in you can set a new password directly.",
  "请填写邮箱和收到的 6 位数验证码。": "Enter the email and the 6-digit code you received.",
  "已登录。忘了密码的话，现在就可以直接设一个新密码。": "Signed in. If you forgot your password, you can set a new one right now.",
  "请填写邮箱。": "Enter an email.",
  "邮箱已验证。": "Email confirmed.",
  "新密码已保存，其他设备上的登录已经退出。": "New password saved; other devices are signed out.",
  "暂时无法验证邮箱，请稍后再试。": "Your email cannot be confirmed right now. Try again shortly.",
  "暂时无法保存密码，请稍后再试。": "The password cannot be saved right now. Try again shortly.",
  "没有填邮箱。": "No email.",
  "两次输入的密码不一样。": "The two passwords differ.",
  "请填写用户名（或邮箱）和密码。": "Enter your username (or email) and password.",
  "暂时无法登录，请稍后再试。": "Signing in is not possible right now. Try again shortly.",
  "暂时无法退出登录，请稍后再试。": "Signing out is not possible right now. Try again shortly.",
  "已退出登录。这个浏览器不再保留你的账号和房间身份。":
    "Signed out. This browser no longer keeps your account or your room identities.",
  "这个 Google 邮箱已经属于一个用密码注册的账号；请用那个账号的用户名和密码登录。":
    "This Google email belongs to an account registered with a password; sign in with that account's username and password.",
  "Google 登录没有完成，请再试一次。": "Google sign-in did not finish. Please try again.",
  // Undo requests (src/main.js): the panel, and a request ended by a move.
  "已申请撤回你的上一手，等待对方回应。计时照走；轮到你时直接落子会撤回申请。":
    "You asked to take back your last move; waiting for your opponent. The clock keeps running; playing a move on your turn withdraws the request.",
  "黑方申请撤回自己的上一手。轮到你时直接落子视为拒绝。":
    "Black asks to take back their last move. Playing a move on your turn declines it.",
  "白方申请撤回自己的上一手。轮到你时直接落子视为拒绝。":
    "White asks to take back their last move. Playing a move on your turn declines it.",
  "你已落子，悔棋申请自动取消。": "You played a move, so your undo request was withdrawn.",
  "对方已落子，撤回了悔棋申请。": "Your opponent played a move and withdrew their undo request.",
  "对方直接落子，视为拒绝你的悔棋申请。": "Your opponent played a move instead, declining your undo request.",
  "你已落子，视为拒绝对方的悔棋申请。": "You played a move, declining your opponent's undo request.",
  // My games (src/app/myGames.js).
  "对局中断": "Interrupted",
  "联机对局": "Online game",
  "本机对局": "Game on this device",
  "回放": "Replay",
  "只从你的棋谱里移除；对方的那份不受影响": "Removes it from your games only; the other player keeps theirs",
  "还没有棋谱。下完一盘棋，它会自动出现在这里。": "No games yet. Finish a game and it appears here automatically.",
  "这个棋类还没有棋谱。": "No games of this kind yet.",
  "正在读取棋谱…": "Loading your games…",
  "暂时无法读取棋谱，请稍后再试。": "Your games cannot be loaded right now. Try again shortly.",
  "已从你的棋谱中移除。": "Removed from your games.",
  "暂时无法移除，请稍后再试。": "It cannot be removed right now. Try again shortly.",
  "正在打开棋谱…": "Opening the game…",
  "暂时无法打开棋谱，请稍后再试。": "The game cannot be opened right now. Try again shortly.",
  "现在不能落子。": "A move cannot be played right now.",
  "这个位置不在棋盘上。": "That point is outside the board.",
  "这里已经有棋子了。": "That point is already occupied.",
  "禁入点：落子后这一块棋没有气。": "Suicide is not allowed: this group would have no liberties.",
  "全局同形禁着：不能重复之前出现过的局面。": "Positional superko: a previous board position cannot be repeated.",
  "现在还没有进入点目阶段。": "Scoring has not started yet.",
  "点目结果已经变化，请核对最新结果后重新确认。": "Scoring has changed. Review the latest result before confirming again.",
  "房间暂时无法恢复或保存，请稍后重新连接。": "The room cannot be restored or saved right now. Please reconnect later.",
  "点目时请点击棋子来标记死活。": "During scoring, select a stone to mark its group dead or alive.",
  "现在没有可以撤回的棋步。": "There are no moves to undo.",
  "这一手不能下。": "That move is not legal.",
  // Room messages for games other than Go (src/multiplayer/roomEngine.js).
  "这个棋类暂不支持这种对局方式。": "This game does not support that kind of match yet.",
  "棋类无效。": "That game is not available.",
  "持久化棋类无效。": "The stored game type is invalid.",
  "对局规则设置无效。": "The game rule settings are invalid.",
  "五子棋棋盘宽高必须是 5 到 30 之间的整数。":
    "Gomoku boards need whole-number sides from 5 to 30.",
  "黑白棋棋盘宽高必须是 4 到 30 之间的偶数。":
    "Othello boards need even sides from 4 to 30.",
  "黑方禁手，不能落在这里。": "That point is forbidden for Black.",
  "黑方禁手：长连。": "Forbidden for Black: overline.",
  "黑方禁手：四四。": "Forbidden for Black: double four.",
  "黑方禁手：三三。": "Forbidden for Black: double three.",
  "必须夹住至少一枚对方棋子。": "A move must outflank at least one disc.",
  // Gomoku and Othello AI engines and levels (src/ai/gameAiRegistry.js).
  "拓扑黑白棋 AI": "Topology Othello AI",
  "简单": "Easy",
  "普通": "Normal",
  "困难": "Hard",
  "AI 难度": "AI difficulty",
  "白方 AI 难度": "White AI difficulty",
  "黑方 AI 难度": "Black AI difficulty",
  "AI 在房主浏览器中思考，难度只影响思考时间和搜索深度":
    "The AI thinks in the host browser; difficulty only changes its thinking time and search depth",
  "AI 对 AI 时黑白双方可分别选择难度": "In AI vs AI, Black and White can have different difficulties",
  "AI 在房主浏览器中运行，服务器只验证并同步棋步": "The AI runs in the host browser; the server only validates and syncs its moves",
  "观看 AI 控制黑白双方": "Watch the AI play both Black and White",
  "和 AI 下一盘": "Play a game against the AI",
  "调整房间里的 AI": "Adjust the room's AI",
  "AI 在浏览器后台按当前棋盘的接缝规则选择落点。无需账号或第三方 API，服务器不承担推理。":
    "The AI chooses its moves in a background worker by this board's seam rules. No account or third-party API is needed, and the server does no inference.",
  "AI 在浏览器后台运行，无需下载大型模型；每一手都按当前棋盘的接缝规则检查。":
    "The AI runs in a background worker without a large model download; every move is checked against this board's seam rules.",
  "简单会留出机会，普通会抓住明显的胜负手，困难会多看对方的一手应对。":
    "Easy leaves openings, Normal takes the clear winning and saving moves, and Hard also weighs the opponent's best reply.",
  "这个棋类暂不支持 AI。": "This game does not support AI yet.",
  "AI 返回了无法提交的在线棋步。": "The AI returned an online move that could not be submitted.",
  "把邀请链接发给朋友，或让 AI 接替空缺的白方座位。":
    "Share the invitation link, or let the AI take the open White seat.",
  "已退出 AI 对局并保留当前棋局；现在可以本地轮流落子，或重新开始 AI 对局。":
    "The AI game ended but the position was kept. You can continue locally or start another AI game.",
  // Game names, rule sets and results shown by src/ui/gameUi.js.
  "围棋": "Go",
  "五子棋": "Gomoku",
  "黑白棋": "Othello",
  "自由规则": "Freestyle",
  "禁手规则（连珠）": "Renju",
  "棋盘已满，和棋": "Board full: draw",
  "黑方已无可下之处，和棋": "Black has no legal point left: draw",
  "棋盘已满，和棋。": "Board full: draw.",
  "双方和棋。": "Draw.",
  "黑方已无可下之处，和棋。": "Black has no legal point left: draw.",
  "黑方子数": "Black discs",
  "白方子数": "White discs",
  "五子棋棋盘每边至少 5 路。": "Gomoku boards need at least 5 lines per side.",
  "黑白棋棋盘宽高须为 4–30 的偶数。": "Othello boards need even sides from 4 to 30.",
  "这个棋类暂不支持 AI 对手、AI 分析或 SGF 棋谱。":
    "This game does not support AI opponents, AI analysis or SGF records yet.",
  "五子棋和黑白棋暂不支持 AI，请选择好友或本地双人对局。":
    "Gomoku and Othello have no AI yet. Choose a friend or a same-device game.",
  "这个棋类暂不支持 AI 分析。": "This game does not support AI analysis yet.",
  "黑方禁手点已用 ✕ 标出。": "Points forbidden for Black are marked with ✕.",
  "这里不能标记。": "That point cannot be marked.",
  "当前不能认输。": "You cannot resign right now.",
  "当前状态不能执行这个操作。": "That action is unavailable in the current state.",
  "请先退出复盘，再操作棋局。": "Exit replay before changing the live game.",
  "黑方": "Black",
  "白方": "White",
  "黑": "Black",
  "白": "White",
  "你": "You",
  "旁观": "Spectator",
  "旁观者": "Spectator",
  "旁观聊天": "Spectator chat",
  "对局聊天": "Game chat",
  "只读：旁观者可以阅读对局聊天，但不能在这里发言。":
    "Read-only: spectators can read game chat but cannot post here.",
  "旁观聊天只对旁观者可见，不会显示给黑白双方。":
    "Spectator chat is visible only to spectators and never appears for Black or White.",
  "还没有旁观者消息。": "No spectator messages yet.",
  "还没有对局聊天。": "No game chat yet.",
  "已引用 📍 {label}；发送后当前频道可以点击定位。":
    "Mentioned 📍 {label}; people in the current channel can jump to it after you send.",
  "人类玩家": "Human player",
  "人类": "Human",
  "双方和棋": "Draw",
  "竹筒": "Cylinder",
  "甜甜圈": "Torus",
  "莫比乌斯": "Möbius",
  "中国规则": "Chinese rules",
  "简化领地计分": "Simplified territory scoring",
  "停一手": "Pass",
  "自选点": "Selected point",
  "选": "Pick",
  "浏览器": "browser",
  "等待设置": "Waiting for setup",
  "等待接受": "Waiting for acceptance",
  "正在进行": "In progress",
  "已经结束": "Finished",
  "好友对战": "Friend match",
  "人机对战": "Human vs AI",
  "同机双人": "Same-device two-player",
  "刚刚更新": "updated just now",
  "计时": "Timed",
  "返回房间": "Return to room",
  "返回大厅": "Back to lobby",
  "观战": "Watch",
  "空盘": "Empty board",
  "成为白方": "Take the White seat",
  "释放席位，继续旁观": "Release seat and keep watching",
  "正在读取公开房间…": "Loading public rooms…",
  "暂时无法读取在线大厅。": "The online lobby is temporarily unavailable.",
  "好友对局": "Friend match",
  "在线人机": "Online human vs AI",
  "在线 AI 对弈": "Online AI vs AI",
  "在线同机双人": "Online same-device two-player",
  "等待被邀请方回应。": "Waiting for the invited player to respond.",
  "设置并发起一盘新棋": "Configure and start a new game",
  "对局邀请等待回应": "Game invitation awaiting response",
  "KataGo 在浏览器运行，朋友可以观战":
    "KataGo runs in the browser while friends spectate",
  "房间对局已同步给所有成员": "This room game is synced to everyone",
  "房间已经建立。请在棋盘设置中确认配置并发起对局。":
    "The room is ready. Confirm the configuration under Board Settings and start a game.",
  "房主正在准备下一盘棋；你可以继续聊天或等待邀请。":
    "The host is preparing the next game; you can keep chatting or wait for an invitation.",
  "邀请已发出，等待对方接受或拒绝。":
    "The invitation was sent. Waiting for the other player to accept or decline.",
  "房主发来了对局邀请，请接受或拒绝。":
    "The host sent a game invitation. Accept or decline it.",
  "这盘棋正在等待受邀玩家回应。":
    "This game is waiting for the invited player to respond.",
  "房主邀请你开始对局": "The host invites you to start",
  "等待受邀玩家回应": "Waiting for the invited player",
  "使用当前设置发起对局邀请": "Send invitation with these settings",
  "使用当前设置开始在线对局": "Start online game with these settings",
  "白方席位为空；请先让对手进入房间并成为白方":
    "The White seat is empty. Ask your opponent to enter the room and take White first.",
  "白方席位目前为空。请先让朋友进入房间并成为白方，然后才能发送对局邀请。":
    "The White seat is empty. Ask your friend to enter and take White before sending the game invitation.",
  "白方席位目前为空；请先让对手加入房间，再发送对局邀请。":
    "The White seat is empty. Ask your opponent to join before sending a game invitation.",
  "请先取消自己的悔棋申请，再继续下棋。":
    "Cancel your own undo request before continuing play.",
  "当前邀请仍在等待回应；请先取消邀请再修改。":
    "The current invitation is still awaiting a response. Cancel it before making changes.",
  "当前对局尚未结束，不能发起新棋。":
    "The current game is not over, so a new game cannot be started.",
  "正在发送对局邀请…": "Sending game invitation…",
  "正在开始在线对局…": "Starting online game…",
  "对局邀请已发出，等待对方接受。所有设置会保留在当前房间。":
    "The game invitation was sent. Waiting for the other player to accept; all settings will remain in this room.",
  "下一局设置": "Next-game settings",
  "AI · 黑方": "AI · Black",
  "当前浏览器不支持后台 AI 复盘。":
    "This browser does not support background AI replay review.",
  "当前浏览器不支持后台 AI 局势分析。":
    "This browser does not support background AI position analysis.",
  "当前浏览器没有检测到 WebGPU，无法使用 b18，请选择 b10。":
    "WebGPU was not detected in this browser. Choose b10 instead of b18.",
  "当前搜索没有返回更长的变化。": "This search did not return a longer variation.",
  "房间正在连接或同步，请稍等一下。":
    "The room is connecting or syncing. Please wait.",
  "你还没有可以撤回的棋步。": "You do not have a move to undo yet.",
  "棋局已经更新；上一局面的分析已停止，可重新分析最新局面。":
    "The game changed. Analysis of the previous position stopped; you can analyze the latest position again.",
  "请等待白方真人加入，或由房主接入 AI。":
    "Wait for a human White player to join, or let the host attach an AI.",
  "请先结束当前对局并返回房间，再邀请下一局。":
    "Finish the current game and return to the room before inviting the next one.",
  "现在轮到在线 AI 思考；棋步会由房主浏览器提交并由服务器验证。":
    "The online AI is thinking. Its move will be submitted by the host browser and validated by the server.",
  "在线对局尚未结束；为保证公平，比赛双方暂不能使用 AI 复盘。":
    "The online game is still in progress. For fair play, both players cannot use AI replay review yet.",
  "这份棋谱里没有可以分析的行棋局面。":
    "This record has no played position available for analysis.",
  "这是观战入口；填写名字后请选择“进入观战”。":
    "This is the spectator entrance. Enter your name, then choose Enter as spectator.",
  "这是大厅的玩家入口；填写名字后申请空余的对手席位。":
    "This is the lobby player entrance. Enter your name to request the open opponent seat.",
  "创建在线房间": "Create online room",
  "进入观战": "Enter as spectator",
  "申请对手席位": "Request opponent seat",
  "创建一个 3D 棋局": "Create a 3D game",
  "进入 3D 棋局": "Enter a 3D game",
  "先创建房间；进入后可以在棋盘设置中配置棋局并邀请对手。":
    "Create the room first. Once inside, configure the board and invite an opponent.",
  "普通分享链接默认只进入观战，不会占用黑白座位。":
    "A normal share link opens spectator mode and never takes a player seat.",
  "大厅确认该房间有空位；服务器仍会在进入时再次核验座位。":
    "The lobby reports an open seat; the room server verifies it again when you enter.",
  "输入房间号后，可以申请对手席位，也可以只进入观战。":
    "Enter a room code to request the opponent seat or watch without taking a seat.",
  "白方席位目前空缺；点击“成为白方”即可加入对局，其他观众仍可继续旁观。":
    "The White seat is open. Choose Take the White seat to join; other visitors can keep watching.",
  "你当前占用白方席位；如果不参加下一局，可以释放席位并继续旁观。":
    "You currently hold the White seat. Release it to keep watching without joining the next game.",
  "释放白方席位后，你会继续留在房间旁观，其他观众可以接替白方。确定继续吗？":
    "After releasing White, you will remain as a spectator and another viewer may take the seat. Continue?",
  "已释放白方席位；你将继续留在房间旁观。":
    "White was released. You remain in the room as a spectator.",
  "已成为白方；现在可以回应邀请或等待房主发起对局。":
    "You now hold the White seat. Respond to an invitation or wait for the host to start a game.",
  "白方席位已经有人使用；如需改为 AI 或同机对局，请先让白方释放席位。":
    "The White seat is occupied. Ask White to release it before switching to AI or same-device play.",
  "已沿用上一局设置；可以直接开始，也可以先调整棋盘。房间成员和聊天记录都会保留。 白方席位已经有人使用；如需改为 AI 或同机对局，请先让白方释放席位。":
    "The previous settings are prefilled; start now or adjust the board first. Room members and chat history will remain. The White seat is occupied, so ask White to release it before switching to AI or same-device play.",
  "这是棋谱当前末尾，没有实战下一手可比较。":
    "This is the current end of the record, so there is no next played move to compare.",
  "KataGo 正在房主浏览器中思考；服务器会验证并同步棋步。":
    "KataGo is thinking in the host browser; the server will validate and sync the move.",
  "b18 首次需要下载约 93.4 MB，并会占用数百 MB 内存与显存、增加耗电和发热。仅建议桌面端 WebGPU。确定使用吗？":
    "b18 initially downloads about 93.4 MB and uses hundreds of MB of RAM/VRAM, increasing power use and heat. It is recommended only for desktop WebGPU. Use it anyway?",
  "单机模式": "Local game",
  "在线房间": "Online room",
  "在线人机房间": "Online AI room",
  "在线 AI 对战": "Online AI game",
  "AI 对战": "AI game",
  "AI 自对弈": "AI vs AI",
  "我的房间": "My Room",
  "本地双人": "Local two-player",
  "房间准备": "Room preparation",
  "邀请已发出": "Invitation sent",
  "等待对手加入": "Waiting for an opponent",
  "邀请对局后开始": "Starts after you invite a game",
  "棋局尚未开始": "The game has not started",
  "棋盘预览 · 可拖动查看": "Board preview · drag to explore",
  "棋盘预览 · 等待对手": "Board preview · waiting for opponent",
  "当前房间 · 下一局设置": "Current room · Next-game settings",
  "预览下一局棋盘": "Preview the next board",
  "确认设置后同步开局": "Confirm settings to start for everyone",
  "下一局预览 · 可拖动查看": "Next-game preview · drag to explore",
  "双方在同一台设备轮流落子": "Both players take turns on this device",
  "对局开始后，才可以分析当前局面或复盘棋谱。": "Position analysis and replay become available after the game starts.",
  "确认下一局设置并开局后，才可以进行局势分析。": "Confirm the next-game settings and start the game before running position analysis.",
  "请先退出当前联机房间，再邀请一场新对局。": "Leave the current online room before inviting a new game.",
  "请先结束当前对局，再准备下一局。": "Finish the current game before preparing the next one.",
  "直接进行下一局": "Start next game now",
  "调整下一局设置": "Adjust next-game settings",
  "退出房间": "Leave Room",
  "关闭本页联机": "Disconnect this tab",
  "忘记房间": "Forget room",
  "留在房间等待下一局": "Stay and wait for the next game",
  "正在当前房间设置下一局；确认后会同步给所有玩家和观众。": "Configuring the next game in this room. It will sync to all players and spectators when confirmed.",
  "黑方房主正在设置下一局；聊天和房间成员都会保留。": "The Black host is configuring the next game. Chat and room members will be kept.",
  "本局已结束；黑方可直接进行下一局，或调整下一局设置；成员和聊天记录都会保留。": "This game is over. Black can start the next game immediately or adjust its settings; room members and chat history will be kept.",
  "本局已结束；等待黑方房主开始或设置下一局。": "This game is over. Wait for the Black host to start or configure the next game.",
  "本局已结束；可以直接进行下一局，或先调整下一局设置；成员和聊天记录都会保留。": "This game is over. Start the next game immediately or adjust its settings first; room members and chat history will be kept.",
  "本局已结束；等待黑方房主直接开始或调整下一局设置。": "This game is over. Wait for the Black host to start the next game immediately or adjust its settings.",
  "你看到的是下一局预览。开始后，房间号、双方座位、观众和聊天记录都会保留。": "This is the next-game preview. The room code, seats, spectators, and chat history will remain when it starts.",
  "等待黑方房主发起下一局；你仍可在“聊天”中继续交流。": "Wait for the Black host to start the next game. You can keep talking under Chat.",
  "你已留在当前房间；等待黑方房主设置并发起下一局，聊天记录会继续保留。": "You stayed in this room. Wait for the Black host to configure and start the next game; chat history will remain.",
  "等待黑方房主设置并发起下一局；你可以继续聊天。": "Wait for the Black host to configure and start the next game. You can keep chatting.",
  "等待黑方房主设置并发起下一局；你可以继续聊天，或退出房间。": "Wait for the Black host to configure and start the next game. You can keep chatting or leave the room.",
  "仍在当前在线房间。已沿用上一局设置；可以直接确认，也可以先调整棋盘。": "You are still in the same online room. The previous game's settings are prefilled. Confirm now or adjust the board first.",
  "已沿用上一局的对手和棋盘设置；可以直接确认，也可以先调整棋盘。": "The previous opponent and board settings are preserved. Confirm now or adjust the board first.",
  "已沿用上一局设置；可以直接开始，也可以先调整棋盘。房间成员和聊天记录都会保留。": "The previous game's settings are prefilled. Start now or adjust the board first. Room members and chat history will be kept.",
  "仍在当前在线房间。上一局设置已预填；调整或确认后，由黑方房主开始下一局，成员和聊天都会保留。": "You are still in the same online room. The previous settings are prefilled; after confirming or adjusting them, the Black host can start the next game while room members and chat are kept.",
  "仍在当前在线房间。调整下一局棋盘后点击“使用当前设置开始下一局”；成员和聊天都会保留。": "You are still in the same online room. Adjust the next board, then select Start next game with these settings; members and chat will remain.",
  "上一局设置已预填；调整后点击“使用当前设置开始下一局”。": "The previous game's settings are prefilled. After adjusting them, select Start next game with these settings.",
  "这是下一局的棋盘预览；请先确认设置并发起下一局。": "This is a preview of the next board. Confirm the settings and start the next game first.",
  "这是下一局的棋盘预览；请先确认设置并开始下一局。": "This is a preview of the next board. Confirm the settings and start the next game first.",
  "下一局设置期间不能进入复盘；请先确认开局。": "Replay is unavailable while configuring the next game. Confirm the game first.",
  "请先开始下一局，或留在当前终局后再导入棋谱。": "Start the next game first, or return to the finished position before importing an SGF.",
  "棋局尚未开始；请先在房间里邀请一场对局。": "The game has not started. Invite a game from the room first.",
  "棋局尚未开始；请先邀请 AI、好友或本地对手。": "The game has not started. Invite AI, a friend, or a local opponent first.",
  "当前棋局没有可导出的棋谱。": "There is no game record to export.",
  "至少下一手棋后，才能开始复盘。": "Play at least one move before starting replay.",
  "这份棋谱暂时无法复盘，请继续当前对局或建立新棋盘。": "This record cannot be replayed right now. Continue the game or return to the room for a new one.",
  "已退出 AI 对战，回到我的房间；可以重新邀请对局。": "Left the AI game and returned to My Room. You can invite another game.",
  "已回到我的房间，可以重新邀请一场对局。": "Returned to My Room. You can invite another game.",
  "本地双人对局已开始：黑白双方在这台设备上轮流落子。": "Local two-player game started. Black and White take turns on this device.",
  "先调整棋盘、规则与计时；邀请对局时会使用同一套设置。": "Configure the board, rules, and clock first. The invitation will use those settings.",
  "先在“棋盘设置”中调整棋盘；创建房间时会使用这里的同一套设置。": "Configure the board under Board Settings. Creating a room will use the same settings.",
  "选择电脑或朋友作为对手": "Choose an AI or a friend as your opponent",
  "和朋友共享同一盘棋": "Share this game with a friend",
  "和 KataGo 对弈，朋友可以观战": "Play KataGo while friends spectate",
  "等待黑方": "Waiting for Black",
  "等待白方": "Waiting for White",
  "等待白方加入": "Waiting for White",
  "等待白方加入后即可对弈。": "The game can start when White joins.",
  "把邀请链接发给朋友，或让 KataGo 接替空缺的白方座位。": "Share the invitation link, or let KataGo take the open White seat.",
  "你正在旁观；可切换到“分析”，在本页研究候选与分支。": "You are spectating. Open Analysis to study local candidates and variations.",
  "连接成功，正在同步最新棋局…": "Connected. Syncing the latest position…",
  "正在连接房间，稍等一下…": "Connecting to the room…",
  "连接已断开，正在等待恢复…": "Disconnected. Waiting to reconnect…",
  "网络已断开；恢复后会自动重新连接。": "The network is down; the room reconnects as soon as it is back.",
  "连接中断，正在重新连接…": "Connection lost. Reconnecting…",
  "正在连接房间…": "Connecting to the room…",
  "连接中": "Connecting",
  "正在重连": "Reconnecting",
  "实时连接": "Live",
  "需要联机": "Online room required",
  "这个席位已在另一个窗口打开，本页已停止重连。": "This seat is open in another window, so this page stopped reconnecting.",
  "已恢复对局，可以继续处理有争议的死活。": "Play resumed. You can continue resolving disputed groups.",
  "房间已建立不同形状的新棋盘，复盘已结束并切回实时局面。": "The room created a board with different settings. Replay ended and the live position is shown.",
  "轮到在线 AI 行棋，已自动退出复盘以保持房间对局和计时继续。": "Online AI is to move, so replay closed automatically to keep the game and clock running.",
  "请先创建或加入一个联机房间。": "Create or join an online room first.",
  "房间正在重连，请连接恢复后再操作。": "The room is reconnecting. Wait for the connection before acting.",
  "连接已经恢复，正在核对最新棋局，请稍等一下。": "The connection is back. Verifying the latest position…",
  "正在同步房间棋局，请稍等一下。": "Syncing the room position…",
  "本局已经结束；可以直接进行下一局，或调整下一局设置。": "The game is over. Start the next game immediately or adjust its settings.",
  "本局已经结束；可以直接进行下一局，或先调整下一局设置。": "The game is over. Start the next game immediately or adjust its settings first.",
  "本局已经结束；请使用“直接进行下一局”或“调整下一局设置”。": "This game is over. Use Start Next Game Now or Adjust Next-Game Settings.",
  "本页已退出联机；另一个窗口中的对局不受影响。": "This page left the room; the game in the other window is unaffected.",
  "已退出联机房间，回到之前的单机棋盘。": "Left the online room and restored the previous local board.",
  "已停止重连并忘记这个房间。": "Stopped reconnecting and forgot this room.",
  "房间正在重连；连接恢复后才能安全释放座位。": "The room is reconnecting. The seat can be released after the connection returns.",
  "当前无法通知服务器释放座位。忘记房间只会清除本机凭据，原座位可能继续保留。确定继续吗？": "The server cannot be reached to release your seat. Forgetting the room only removes local credentials, so the seat may remain occupied. Continue?",
  "退出房间会释放你的座位，确定退出吗？": "Leaving the room will release your seat. Continue?",
  "对局正在进行，退出房间会判你认输并释放座位。确定退出吗？": "A game is in progress. Leaving the room resigns the game and releases your seat. Continue?",
  "没有收到服务器的退出确认，座位仍然保留，请重试。": "The server did not confirm that you left; your seat is still reserved. Try again.",
  "房间已因长时间无活动而关闭。": "The room closed after being inactive for too long.",
  "房间身份已经失效，请重新加入。": "Your room identity has expired. Join again.",
  "请输入你的名字。": "Enter your name.",
  "请先填写你的名字。": "Enter your name first.",
  "房间号格式不正确。": "The room code is not valid.",
  "无法生成分享链接。": "Could not create a share link.",
  "缺少房间凭证。": "Room credentials are missing.",
  "联机服务地址不正确。": "The online service address is invalid.",
  "联机命令缺少动作。": "The online command is missing an action.",
  "服务器没有返回有效的房间凭证。": "The server did not return valid room credentials.",
  "联机时发生未知错误。": "An unknown online error occurred.",
  "当前环境不支持网络请求。": "Network requests are not supported in this environment.",
  "无法连接联机服务。": "Could not connect to the online service.",
  "没有可恢复的房间会话。": "There is no room session to restore.",
  "当前环境不支持 WebSocket。": "WebSocket is not supported in this environment.",
  "无法建立房间连接。": "Could not open the room connection.",
  "房间连接发生错误。": "The room connection encountered an error.",
  "房间会话已经停止。": "The room session has stopped.",
  "收到无法识别的房间消息。": "Received an unrecognized room message.",
  "客户端与房间服务版本不兼容，请刷新页面。": "The client and room service versions are incompatible. Refresh the page.",
  "房间拒绝了这个操作。": "The room rejected this action.",
  "尚未加入房间。": "You have not joined a room.",
  "联机命令编号重复。": "The online command ID is duplicated.",
  "等待服务器确认超时。": "Timed out waiting for server confirmation.",
  "发送房间命令失败。": "Failed to send the room command.",
  "房间连接已关闭。": "The room connection is closed.",
  "当前环境无法安全生成房间凭证。": "This browser cannot generate secure room credentials.",
  "无法生成有效的房间号。": "Could not generate a valid room code.",
  "无法保存建房凭据，请检查浏览器存储设置后重试。":
    "Could not save the room-creation credentials. Check browser storage settings and try again.",
  "没有可重试的建房请求。": "There is no room creation to retry.",
  "无法移除已冲突的建房凭据，请检查浏览器存储设置。":
    "Could not remove conflicting room-creation credentials. Check browser storage settings.",
  "服务器返回的建房身份与请求不一致。": "The server returned a host identity that does not match the request.",
  "暂时无法分配房间码，请重试。": "Could not allocate a room code right now. Try again.",
  "没有可恢复的加入请求。": "There is no join request to recover.",
  "无法保存加入凭据，请检查浏览器存储设置后重试。":
    "Could not save the join credentials. Check browser storage settings and try again.",
  "服务器返回的加入身份与请求不一致。": "The server returned an identity that does not match the join request.",
  "无法保存房间会话，请检查浏览器存储设置后重试。":
    "Could not save the room session. Check browser storage settings and try again.",
  "尚未取得可确认的棋局局面，请等待房间同步。": "The current position is not confirmed yet. Wait for the room to sync.",
  "无法保存联机命令序号，请检查浏览器存储设置后重试。":
    "Could not save the online command sequence. Check browser storage settings and try again.",
  "无法删除当前房间身份的本地凭据；请检查浏览器存储设置。":
    "Could not delete this room identity's local credentials. Check browser storage settings.",
  "当前环境无法连接在线大厅。": "This browser cannot reach the online lobby.",
  "暂时无法连接在线大厅。": "Cannot reach the online lobby right now.",
  "在线大厅暂时不可用。": "The online lobby is unavailable right now.",
  "AI 模型已切换，请重新启动分析线程。": "The AI model changed. Restart the analysis worker.",
  "正在创建…": "Creating…",
  "创建房间": "Create room",
  "正在加入…": "Joining…",
  "加入房间": "Join game",
  "正在进入观战…": "Joining as spectator…",
  "进入观战": "Spectate",
  "邀请链接已复制，可以发给朋友了。": "Invitation link copied. Send it to your friend.",
  "创建房间失败，请稍后重试。": "Could not create the room. Try again shortly.",
  "加入房间失败，请检查房间号。": "Could not join the room. Check the room code.",
  "请输入六位房间号。": "Enter the six-character room code.",
  "正在为房间建立新棋盘…": "Creating a new board for the room…",
  "先在“设置”中调整棋盘；创建房间时会使用这里的同一套设置。": "Adjust the board under Settings first. New rooms use the same settings.",
  "只有在线房间的黑方房主可以把空缺白方接入 AI。": "Only the Black host can attach AI to an open White seat.",
  "当前白方座位不能接入 AI。": "AI cannot take the White seat right now.",
  "白方已经由真人加入，不能再接入 AI。": "A human has joined as White, so AI cannot take that seat.",
  "正在移除在线 AI…": "Removing online AI…",
  "移除在线 AI 后白方座位会重新开放，当前棋局会保留。确定继续吗？": "Removing online AI reopens the White seat and keeps the current game. Continue?",
  "调整 / 重试在线 AI": "Adjust / retry online AI",
  "让 AI 接替白方": "Let AI take White",
  "更新在线 AI": "Update online AI",
  "接入白方座位": "Attach to White seat",
  "调整房间里的 KataGo": "Adjust room KataGo",
  "让 KataGo 接替白方": "Let KataGo take White",
  "AI 仍在房主浏览器中运行，服务器只验证落子并同步给观众。接入后请保持房主页面在线。": "AI runs in the host browser; the server only validates and syncs moves. Keep the host page open.",
  "不计时": "No clock",
  "自由用时": "Untimed",
  "超时": "Time out",
  "本局负": "Lost on time",
  "绝对用时": "Absolute time",
  "超时获胜": "Won on time",
  "时间耗尽": "Time expired",
  "点目暂停": "Paused for scoring",
  "对局结束": "Game over",
  "正在计时": "Clock running",
  "等待对方": "Waiting for opponent",
  "计时暂停": "Clock paused",
  "准备落子": "Ready to play",
  "轮到你落子。": "Your turn.",
  "轮到你了。": "Your turn.",
  "还没有轮到你。": "It is not your turn yet.",
  "轮到 AI，正在准备思考…": "AI's turn. Preparing to think…",
  "AI 正在思考": "AI is thinking",
  // The lobby's own rooms, quick join, presence and links (src/app/lobbyScreen.js).
  "现在没有符合筛选、正在等对手的房间；已为你打开建房窗口。":
    "No room matching these filters is waiting for an opponent, so the create-room window is open for you.",
  "AI 席位": "AI seat",
  "在线": "Online",
  "离线": "Offline",
  "房主暂时离线，回来后才能开局": "The host is offline; the game can start once they are back",
  "复制链接": "Copy link",
  "复制这个房间的分享链接（打开后默认观战）": "Copy this room's share link (it opens as a spectator)",
  "你在观战": "You are watching",
  "你执白": "You play White",
  "你执黑": "You play Black",
  "你的席位": "Your seat",
  "不在大厅（已结束、不公开、没人在或已过期）": "Not in the lobby (finished, unlisted, empty or expired)",
  "确认移除": "Confirm remove",
  "移除": "Remove",
  "只删除这台设备上的记录；房间和其他人的席位不受影响，之后不能再用这个身份返回":
    "Removes only this device's record; the room and other players' seats are unaffected, but you can no longer return with this identity",
  "已复制": "Copied",
  // Move hints in games against AI.
  "提示": "Hint",
  "提示中…": "Hinting…",
  "正在为你计算提示…": "Working out a hint for you…",
  "暂时无法计算提示，请稍后再试。": "A hint cannot be worked out right now. Please try again later.",
  "提示：AI 建议这一手停一手。": "Hint: the AI suggests passing this turn.",
  "AI 准备落子": "AI is ready",
  "AI 自对弈已暂停；可以悔一步、复盘或切换视图。": "AI self-play is paused. You can undo, replay, or change views.",
  "AI 自对弈已暂停；可以复盘、切换视图或悔一步。": "AI self-play is paused. You can replay, change views, or undo one move.",
  "AI 自对弈继续。": "AI self-play resumed.",
  "KataGo 同时控制黑白双方": "KataGo controls both Black and White",
  "KataGo AI 自对弈": "KataGo AI self-play",
  "你 · 黑方": "You · Black",
  "你 · 白方": "You · White",
  "KataGo 返回了无效落点。": "KataGo returned an invalid move.",
  "KataGo 返回了无法提交的在线棋步。": "KataGo returned an online move that could not be submitted.",
  "在线 AI 的棋步没有提交成功，将按最新局面重新判断。": "The online AI move was not accepted. It will reconsider the latest position.",
  "AI 思考时发生错误。": "An error occurred while the AI was thinking.",
  "当前浏览器没有检测到 WebGPU，无法使用 b18；请选择 b10。": "WebGPU was not detected, so b18 is unavailable. Choose b10.",
  "AI 自对弈期间不能手动行棋；可以暂停、复盘或切换棋盘视图。": "Moves are automatic during AI self-play. Pause, replay, or change views instead.",
  "请先暂停 AI 自对弈，再撤回上一手。": "Pause AI self-play before undoing a move.",
  "暂停对弈": "Pause game",
  "继续对弈": "Resume game",
  "AI 自对弈已停在点目阶段：请标记死子并确认结果，或恢复对局。": "AI self-play paused for scoring. Mark dead stones and confirm, or resume play.",
  "双方 AI 连续停着，自对弈已暂停在点目阶段。请标记死子后确认结果。": "Both AIs passed. Self-play is paused for scoring; mark dead stones and confirm.",
  "AI 也停一手，已进入点目。请标记死子后确认结果。": "AI also passed. Scoring has started; mark dead stones and confirm.",
  "双方连续停一手，已进入点目。请先标记双方死子。": "Both players passed. Scoring has started; mark dead stones first.",
  "双方连续停一手，已进入点目。请标记双方死子。": "Both players passed. Scoring has started; mark dead stones.",
  "一方已停着": "One player has passed",
  "对局中": "Playing",
  "点目阶段": "Scoring",
  "确认死子与领地": "Confirm dead stones and territory",
  "双方已停着": "Both players passed",
  "超时终局": "Game ended on time",
  "认输终局": "Game ended by resignation",
  "计时结束": "Clock ended",
  "点目中：请标记死子并确认结果，或恢复对局。": "Scoring: mark dead stones and confirm, or resume play.",
  "点目中：双方可以标记死子，结果需双方确认。": "Scoring: both players may mark dead stones; both must confirm the result.",
  "点目中：系统已预标明确死棋并显示领地；双方核对后确认。": "Scoring: clearly dead groups are pre-marked and territory is shown. Both players should review and confirm.",
  "点目中：系统已预标明确死棋，请核对死活与领地。": "Scoring: clearly dead groups are pre-marked. Review group status and territory.",
  "AI 自对弈已停在点目阶段：系统已预标明确死棋，请核对死活与领地。": "AI self-play paused for scoring. Clearly dead groups are pre-marked; review group status and territory.",
  "双方连续停一手，已进入点目。系统已预标明确死棋并显示黑白领地，请核对。": "Both players passed. Clearly dead groups are pre-marked and Black and White territory is shown for review.",
  "双方 AI 连续停着，自对弈已暂停在点目阶段。系统已预标明确死棋，请核对领地。": "Both AIs passed and self-play paused for scoring. Clearly dead groups are pre-marked; review the territory.",
  "AI 也停一手，已进入点目。系统已预标明确死棋，请核对领地。": "The AI also passed. Clearly dead groups are pre-marked; review the territory.",
  "你已确认当前点目，正在等待对方确认。": "You confirmed the score. Waiting for your opponent.",
  "点目确认已重置，请双方重新确认。": "Score confirmations were reset. Both players must confirm again.",
  "死子标记与点目结果已同步。": "Dead-stone marks and the score are synchronized.",
  "死子标记已同步，之前的确认已重置。": "Dead-stone marks are synchronized; previous confirmations were reset.",
  "点目尚未确认": "Score not confirmed",
  "确认结果": "Confirm result",
  "确认同意结果": "Confirm agreement",
  "已确认，等待对方": "Confirmed; waiting",
  "继续对局": "Resume play",
  "悔棋": "Undo",
  "直接悔棋": "Undo directly",
  "申请悔棋": "Request undo",
  "直接撤回上一手": "Undo the last move",
  "直接撤回你和 AI 的上一轮落子，不需要 AI 同意": "Undo your last turn and the AI reply; no approval needed",
  "直接回到你上一次选择之前，不需要 AI 同意": "Return to before your last choice; no AI approval needed",
  "需要对方同意后才会撤回你的上一手": "Your opponent must approve before your last move is taken back",
  "已申请撤回你的上一手，正在等待对方回应": "You asked to take back your last move; waiting for your opponent",
  "悔棋申请已发送，等待对方回应。": "Undo request sent. Waiting for your opponent.",
  "悔棋申请已结束，棋局继续。": "The undo request ended; the game continues.",
  "悔棋已同意，已撤回申请方的上一手。": "Undo approved; the requester's last move was taken back.",
  "正在发送悔棋申请…": "Sending undo request…",
  "正在直接撤回你和 AI 的上一轮落子…": "Undoing your turn and the AI reply…",
  "正在提交认输…": "Submitting resignation…",
  "没有找到可以撤回的玩家棋步。": "No player move could be undone.",
  "已撤回你和 AI 的上一轮落子，轮到你重新选择。": "Your last turn and the AI reply were undone. Choose again.",
  "已撤回你刚才的一手，轮到你重新选择。": "Your last move was undone. Choose again.",
  "认输": "Resign",
  "本局已经结束，不能再认输。": "This game is already over, so resignation is unavailable.",
  "现在不能悔棋。": "You cannot undo right now.",
  "旁观者不能操作棋局。": "Spectators cannot change the game.",
  "复盘不会修改棋局；请退出复盘后再落子。": "Replay does not change the game. Exit replay before playing a move.",
  "请先退出复盘，再建立新棋盘。": "Exit replay before creating a new board.",
  "联机房间中只有黑方可以建立新棋盘。": "Only Black can create a new board in an online room.",
  "建立新棋盘并清除当前对局？": "Create a new board and clear the current game?",
  "平面或立体视图": "flat or 3D view",
  "平面、弧面或立体视图": "flat, curved, or 3D view",
  "逐手回看，可随时切换棋盘视图": "Review every move and switch board views at any time",
  "复盘整局": "Full replay",
  "整局复盘": "Full replay",
  "续录复盘": "Continued replay",
  "AI 复盘": "AI replay analysis",
  "观战局势分析": "Spectator analysis",
  "人机局势分析": "AI-game analysis",
  "AI 局势分析": "AI position analysis",
  "实战 AI 已锁定": "Live-game AI locked",
  "为保证对局公平，在线黑白双方不能在实战中开启 AI；旁观者与复盘可以使用。": "For fair play, online players cannot use AI during the live game. Spectators and replay may use it.",
  "为保证公平，在线黑白双方不能在实战中使用 AI 局势分析。": "For fair play, online players cannot use AI analysis during the live game.",
  "为保证公平，在线黑白双方的实战页面禁用 AI；复盘时可以使用。": "For fair play, AI is disabled for online players during live play, but available in replay.",
  "以下候选与变化只存在于当前观众页面，不会发送给比赛双方。": "These candidates and variations exist only on this spectator page and are never sent to the players.",
  "分析只在你的浏览器中运行。可悬停候选，或直接在棋盘上自选一点。": "Analysis runs only in your browser. Hover candidates or select a point on the board.",
  "在线 AI 正在行棋；请等它落子后再分析。": "Online AI is moving. Wait for its move before analyzing.",
  "在线 AI 正在房主浏览器中行棋；落子后即可分析，避免抢占对局推理资源。": "Online AI is moving in the host browser. Analyze after it plays to avoid competing for compute.",
  "在线 AI 正在代表白方行棋；请等它落子后再分析，避免房主页面抢占推理资源。": "Online AI is playing White. Wait for its move before analyzing so the host keeps enough compute.",
  "在线 AI 正在房主浏览器中行棋；请等它落子后再进入复盘，避免对局和计时被意外中断。": "Online AI is moving in the host browser. Wait before entering replay so the game and clock are not interrupted.",
  "请等在线 AI 落子后再进入复盘": "Wait for online AI before replay",
  "分析当前局面，查看最多五个候选与后续变化。": "Analyze this position to see up to five candidates and continuations.",
  "分析当前局面": "Analyze position",
  "重新深入分析": "Analyze again",
  "快速分析整局": "Quick full-game analysis",
  "补齐整局分析": "Complete missing analysis",
  "停止分析": "Stop analysis",
  "正在准备分析…": "Preparing analysis…",
  "当前局面已经进入点目或终局，AI 不再推荐落子。": "This position is in scoring or already finished, so AI has no move recommendation.",
  "当前时间点已经进入点目或终局，AI 不再推荐落子。": "This replay point is in scoring or already finished, so AI has no move recommendation.",
  "AI 分析已停止，已完成的结果仍然保留。": "AI analysis stopped; completed results are kept.",
  "棋局已经变化，刚才的分析结果已自动丢弃。": "The position changed, so the previous analysis was discarded.",
  "房间已开始或恢复对局；玩家端 AI 分析已锁定。": "The room started or resumed play; player-side AI analysis is locked.",
  "房间已恢复对局；为保证公平，AI 分析已停止并暂时隐藏。": "The room resumed play. AI analysis stopped and is hidden for fair play.",
  "请先点击“分析当前局面”，再在棋盘上选择想研究的点。": "Analyze the position first, then select a point on the board to explore.",
  "这个点不能作为分析分支的第一手。": "That point cannot start an analysis variation.",
  "候选按本次短搜索排序；数值仅供判断方向，不等同于完整服务器分析。": "Candidates are ranked by this short search. Values are directional estimates, not full server analysis.",
  "停在任意一手，查看最多五个候选；悬停预演，点击固定变化。": "Stop at any move to see up to five candidates. Hover to preview; click to pin a variation.",
  "当前浏览器没有检测到 WebGPU，b18 无法运行，请改选 b10。": "WebGPU was not detected in this browser. Use b10 instead of b18.",
  "KataGo b18 需要桌面端 WebGPU；当前浏览器不支持，请改选 b10。": "KataGo b18 requires desktop WebGPU, which this browser does not support. Use b10.",
  "b18 首次需要下载约 93.4 MB，并会占用数百 MB 内存与显存、增加耗电和发热。仅建议桌面端 WebGPU。确定切换吗？": "b18 initially downloads about 93.4 MB and uses hundreds of MB of RAM/VRAM, increasing power use and heat. It is recommended only for desktop WebGPU. Switch anyway?",
  "使用 b18 分析整局会反复占用大量显存和内存，耗电、发热和等待时间都会明显增加。确定继续吗？": "Using b18 for full-game analysis repeatedly consumes substantial RAM and VRAM, with more power use, heat, and waiting. Continue?",
  "当前浏览器不支持后台 AI 计算。": "This browser does not support background AI computation.",
  "AI 无法读取当前棋局。": "AI could not read the current game.",
  "AI 思考线程没有正常启动。": "The AI worker did not start correctly.",
  "分析线程返回错误": "The analysis worker returned an error",
  "未知错误": "Unknown error",
  "AI 自对弈已开始": "AI self-play started",
  "本机 AI 对手": "Local AI opponent",
  "在线 AI 座位": "Online AI seat",
  "让人类或 KataGo 下一盘": "Play a game with a human or KataGo",
  "让 KataGo 接管房间里的白方": "Let KataGo take the room's White seat",
  "模型会在浏览器后台观察全盘，再按当前棋盘的接缝规则搜索落点。无需账号或第三方 API，服务器不承担推理。": "The model reads the full board in your browser and searches using this topology's seam rules. No account or third-party API is needed; the server does no inference.",
  "AI 仍在房主浏览器中运行，服务器只验证落子并同步给观众。接入后请保持房主页面在线。": "AI runs in the host browser while the server validates and syncs moves. Keep the host page online.",
  "开始对局": "Start game",
  "按新设置重开": "Restart with settings",
  "退出 AI": "Leave AI",
  "已退出 AI 对战；当前棋局保留为普通单机棋局。可继续由双方轮流落子。": "Left the AI game. The position remains as a local hot-seat game.",
  "轻量": "lightweight",
  "增强模型 / 高耗资源": "enhanced / resource intensive",
  "快速模型 / 轻量": "fast / lightweight",
  "轻量模型，首次使用下载约 11 MB；支持 WebGPU、WebGL 和 CPU。": "Lightweight model; first use downloads about 11 MB. Supports WebGPU, WebGL, and CPU.",
  "高耗资源：首次下载约 93.4 MB，会占用大量显存和内存，并增加耗电与发热；仅建议桌面端 WebGPU。": "Resource intensive: first use downloads about 93.4 MB and uses substantial RAM/VRAM, power, and heat. Recommended only for desktop WebGPU.",
  "官方普通围棋网络达到职业级以上；特殊棋盘棋力未标定。": "The official network is above professional strength on standard Go; strength on unusual boards is uncalibrated.",
  "比 b10 网络更强；特殊棋盘未经训练，实际段位仍未标定。": "Stronger than b10, but unusual-board strength remains uncalibrated because it was not trained for these topologies.",
  "b10 快速（特殊棋盘段位未测）": "b10 Fast (unrated on unusual boards)",
  "b18 增强（高耗资源 · 段位未测）": "b18 Enhanced (resource intensive · unrated)",
  "b10 快速（段位未测）": "b10 Fast (unrated)",
  "b18 增强（高耗资源 · 段位未测）": "b18 Enhanced (resource intensive · unrated)",
  "KataGo b10 · 快速（段位未测）": "KataGo b10 · Fast (unrated)",
  "KataGo b18 · 增强（段位未测）": "KataGo b18 · Enhanced (unrated)",
  "约 11 MB": "about 11 MB",
  "约 93.4 MB": "about 93.4 MB",
  "开发版": "Development build",
  "当前为预发布版本": "Current prerelease",
  "当前发布版本": "Current release",
  "音效开": "Sound on",
  "音效关": "Sound off",
  "关闭音效": "Mute sound",
  "开启音效": "Enable sound",
  "还没有消息，先和对手打个招呼吧。": "No messages yet. Say hello to your opponent.",
  "聊天需要进入联机房间；本地棋局的分析、棋谱、设置和复盘仍然完整可用。": "Chat requires an online room. Analysis, records, settings, and replay remain available locally.",
  "旁观者可以阅读聊天，只有黑白双方可以发言。": "Spectators can read chat; only Black and White can send messages.",
  "连接恢复后可以继续发送；当前草稿会保留。": "You can send after reconnecting; your draft is preserved.",
  "请在棋盘上点击要引用的位置；这次点击不会落子。": "Select a board point to reference it; this will not play a move.",
  "文字不做内容审查；仅有技术性长度与频率限制。": "Messages are not moderated; only technical length and rate limits apply.",
  "正在发送…": "Sending…",
  "消息发送失败，请稍后重试。": "Message failed to send. Try again shortly.",
  "这条位置引用已经失效。": "This board reference has expired.",
  "当前复盘的棋盘与房间棋盘不同，不能从这里引用棋点。":
    "This replay uses a different board from the room, so its points cannot be referenced in chat.",
  "没有识别到这个棋点。": "That board point was not recognized.",
  "表情包": "Sticker",
  "发送表情包：{label}": "Send sticker: {label}",
  "好棋！": "Great move!",
  "让我想想": "Let me think",
  "居然下这里": "What a move",
  "笑死": "Haha",
  "承让": "Well played",
  "喝口茶": "Tea break",
  "竹筒之力": "Cylinder power",
  "甜甜圈时间": "Torus time",
  "请输入聊天内容。": "Enter a chat message.",
  "聊天内容格式不正确。": "The chat content is invalid.",
  "聊天消息格式不正确。": "The chat message is invalid.",
  "这个表情包不存在。": "That sticker does not exist.",
  "这条消息包含的字符过大，请缩短后再发送。": "This message contains oversized characters. Shorten it and try again.",
  "请求过于频繁，请稍后再试。": "Too many requests. Wait a minute and try again.",
  "本局进行中，不能更换座位；请等本局结束后再操作。": "Seats cannot change while this game is in progress. Try again after it ends.",
  "操作太频繁了，请稍等一下再试。": "You're doing that too often. Wait a moment and try again.",
  "本次点目的死子标记次数已达上限，请确认结果或继续对局。": "This scoring session has reached its dead-stone marking limit. Confirm the result or resume play.",
  "导出 SGF": "Export SGF",
  "导入 SGF": "Import SGF",
  "有待确认的建房请求": "Pending room creation",
  "旧版部分棋谱缺少提子与劫争历史，仅能近似复盘": "Legacy partial records lack captures and superko history; replay is approximate",
  "可能已经建成。先用原凭据核对；放弃后若已建成，将无法找回该房主身份。": "The room may already exist. Check with the original credentials first. Abandoning a completed request loses its host identity.",
  "选择待确认的房间": "Select a pending room",
  "核对并恢复": "Check and recover",
  "放弃所选恢复凭据": "Discard selected recovery credentials",
  "重试上次建房": "Retry previous room creation",
  "有待确认的建房请求；打开创建房间对话框可核对并恢复。": "A room creation is pending. Open the Create room dialog to check and recover it.",
  "恢复建房请求失败，请重试。": "Could not recover the room creation. Try again.",
  "棋谱中没有可播放的棋步": "The record contains no replayable moves",
  "棋谱文件不能超过 2 MiB。": "The SGF file cannot exceed 2 MiB.",
  "棋谱格式无法生成": "The SGF could not be generated",
  "存在格式兼容处理": "Compatibility adjustments were applied",
  "普通 SGF 不含接缝拓扑；本次按当前棋盘解释。": "Standard SGF has no seam topology; this record uses the currently selected board.",
  "已退出复盘，回到当前棋局。": "Exited replay and returned to the live game.",
  "这是复盘起点。": "This is the start of the replay.",
  "开局局面": "Opening position",
  "复盘至点目": "Replay at scoring",
  "复盘终局": "Replay finished",
  "播放": "Play",
  "暂停": "Pause",
  "搜索估值": "search estimate",
  "无后续变化": "No continuation",
  "平面、弧面或立体视图": "flat, curved, or 3D views",
  "平面或立体视图": "flat or 3D views",
  "只导入了棋谱集合中的第一局": "Only the first game in the collection was imported",
  "只导入了主分支": "Only the main variation was imported",
  "忽略了中盘摆子": "Mid-game setup stones were ignored",
  "忽略了中盘改行棋方": "Mid-game player-to-move changes were ignored",
  "棋谱中存在非交替行棋": "The record contains non-alternating moves",
  "已按简化领地计分解释，双活中的眼仍计地": "Simplified territory scoring was used; seki eyes still count as territory",
  "未知规则已按简化领地计分解释": "The unknown rules were interpreted as Simplified territory scoring",
  "已按 FF[4] 兼容方式解析": "The record was parsed using FF[4] compatibility",
  "文本已按 UTF-8 读取": "The text was read as UTF-8",
  "已兼容旧式 tt 停着": "Legacy tt pass moves were accepted",
  "贴目无效，已按 0 目复盘": "The invalid komi was replaced with 0 for replay",
  "缺少尺寸，已按 19 × 19 解释": "The missing board size was interpreted as 19 × 19",
  "缺少棋类标记，已按围棋解释": "The missing game type was interpreted as Go",
  "缺少尺寸，已按该棋默认尺寸解释": "The missing board size was interpreted as the game's default",
  "未知五子棋规则已按自由规则解释": "The unknown Gomoku rules were interpreted as freestyle",
  "访客对 AI": "Guest vs AI",
  "点目时间已到，正在按当前死子标记自动确认…": "Time is up for the count; confirming the current dead-stone marks…",
  "横向起手可任意拖动 · 竖滑滚动页面": "Start sideways to drag any way · swipe up or down to scroll",
  "棋盘接管所有方向的拖动；可从棋盘外滚动页面。":
    "The board takes drags in every direction; scroll the page from outside the board.",
  "竖向滑动会滚动页面；横向起手的拖动仍可转向任意方向。":
    "Swipes that start up or down scroll the page; a drag that starts sideways can still turn any way.",
  "移出": "Remove",
  "本局结束后才能移出对手": "Your opponent can be removed once this game ends",
  "房主邀请你执白对战 AI": "The host invites you to play White against the AI",
  "访客执白；AI 执黑，在你的浏览器中运行": "The guest plays White; the AI plays Black in your browser",
  "房间已在大厅公开。": "The room is now shown in the lobby.",
  "房间已不在大厅公开；只有拿到房间号或邀请链接的人能进入。":
    "The room is no longer in the lobby; only people with the room code or invitation link can enter.",
  "确定把这位成员移出房间吗？对方需要重新加入才能回来。":
    "Remove this person from the room? They will have to join again to come back.",
  "已把这位成员移出房间。": "Removed them from the room.",
  "判对方弃局后，本局按对方认输结束。确定吗？":
    "Claiming the game as abandoned ends it as your opponent's resignation. Continue?",
  "已判对方弃局，本局结束。": "You claimed the game as abandoned; it is over.",
  "对方离线已满 2 分钟；可以判对方弃局，本局按对方认输结束。":
    "Your opponent has been offline for 2 minutes. You can claim the game; it ends as their resignation.",
  "白方 · 在线": "White · online",
  "白方 · 离线": "White · offline",
  "观战 · 在线": "Watching · online",
  "观战 · 离线": "Watching · offline",
  "棋谱中的停着已跳过，黑白棋会自动跳过无子可下的一方":
    "Recorded passes were skipped; Othello skips a player with no move automatically",
  "属性名已规范化": "Property identifiers were normalized",
  "回正视角": "Reset view",
  "回正甜甜圈": "Reset torus",
  "回正莫比乌斯": "Reset Möbius",
  "重置展开": "Reset pan",
  "重置弧面": "Reset curved view",
  "右键任意方向拖动": "Right-drag in any direction",
  "单指任意方向拖动": "Drag in any direction",
  "右键横向拖动": "Right-drag horizontally",
  "单指横向拖动": "Drag horizontally",
  "右键拖动旋转": "Right-drag to rotate",
  "单指拖动旋转": "Drag to rotate",
  "上下左右循环 · 支持斜向": "Wraps both ways · diagonal drag supported",
  "跨一圈上下翻转 · 两圈复位": "One loop flips vertically · two restore orientation",
  "改变展开起点": "Shift the unfolding seam",
  "弧面循环 · 滚轮缩放": "Curved wrap · wheel to zoom",
  "观察内圈与背面 · 滚轮缩放": "Inspect inner and back surfaces · wheel to zoom",
  "观察单面扭转与唯一边界 · 滚轮缩放": "Inspect the one-sided twist and single edge · wheel to zoom",
  "滚轮缩放": "Wheel to zoom",
  "弧面循环 · 双指缩放": "Curved wrap · pinch to zoom",
  "观察内圈与背面 · 双指缩放": "Inspect inner and back surfaces · pinch to zoom",
  "观察单面扭转与唯一边界 · 双指缩放": "Inspect the one-sided twist and single edge · pinch to zoom",
  "双指缩放": "Pinch to zoom",
  "左键点击落子": "Left-click to play",
  "轻点落子": "Tap to play",
  "立体竹筒": "3D cylinder",
  "立体甜甜圈": "3D torus",
  "立体莫比乌斯": "3D Möbius",
  "可横向滑动的竹筒表面平面展开棋盘": "Flat cylinder board; pan horizontally",
  "可向任意方向循环滑动的甜甜圈平面展开棋盘": "Flat torus board; pan and wrap in any direction",
  "可横向滑动、跨一圈后上下翻转的莫比乌斯平面展开棋盘": "Flat Möbius board; pan horizontally and flip after one loop",
  "A列与末列相邻": "Column A joins the last column",
  "A列与末列倒序相邻": "Column A joins the last column in reverse order",
  "📍 点击一个棋点引用到聊天（不会落子）": "📍 Select a point to reference in chat (no move played)",
  "◇ 点击棋点，只在本页建立分析分支": "◇ Select a point to create a local analysis branch",
  "普通 SGF 阅读器可读取棋步；异形接缝保存在 X* 扩展属性中。":
    "Standard SGF readers can read the moves; unusual-board seams are stored in X* extension properties.",
  "本局采用简化领地计分，双活中的眼仍计地。":
    "This game uses simplified territory scoring; seki eyes still count as territory.",
  "文件不是可识别的 SGF 棋谱": "The file is not a recognizable SGF record",
  "导入的 SGF": "the imported SGF",
  "AI 分析已停止，当前已有结果仍然保留。": "AI analysis stopped; the current results are kept.",
  "神经网络正在观察局面…": "The neural network is reading the position…",
  "暂停复盘": "Pause replay",
  "播放复盘": "Play replay",
  "正在暂停在线 AI 自对弈…": "Pausing online AI self-play…",
  "正在继续在线 AI 自对弈…": "Resuming online AI self-play…",
  "正在暂停…": "Pausing…",
  "正在继续…": "Resuming…",
  "直接撤回上一手，保持暂停": "Undo the last move and stay paused",
  "请先暂停 AI 自对弈，再撤回上一手": "Pause AI self-play before undoing a move",
  "在线 AI 自对弈已继续。": "Online AI self-play resumed.",
  "在线 AI 自对弈已暂停；可以悔一步、复盘或切换视图。":
    "Online AI self-play is paused. You can undo one move, replay, or change views.",
  "棋局已更新，正在核对在线 AI 暂停状态…": "The game changed. Checking the online AI pause state…",
  "正在直接撤回上一手…": "Undoing the last move…",
  "旧棋局只记录了升级后的棋步；仍可切换任意可用视图。":
    "This older game only recorded moves made after the upgrade. You can still switch to any available view.",
  "轮到你落子": "Your turn",
  "最上行与最下行相邻": "Top and bottom rows connect",
  "莫比乌斯唯一边界": "The Möbius strip's single edge",
  "点击引用到聊天（不会落子）": "select to reference in chat (no move played)",
  "请先选择要恢复的房间身份。": "Choose the room identity to restore first.",
  "所选身份的恢复凭据已失效。可使用下方按钮以新身份进入。":
    "The selected identity's recovery credentials have expired. Use the buttons below to enter with a new identity.",
  "恢复房间身份失败。": "Could not restore the room identity.",
  "所选身份": "the selected identity",
  "已停止重连，但本地房间凭据未能删除，恢复入口可能再次出现；请检查浏览器存储设置。":
    "Stopped reconnecting, but the local room credentials could not be deleted, so the recovery option may reappear. Check browser storage settings.",
  "已退出联机房间，但本地凭据未能删除，恢复入口可能再次出现；请检查浏览器存储设置。":
    "Left the online room, but the local credentials could not be deleted, so the recovery option may reappear. Check browser storage settings.",
  "所选加入请求已失效，请重新选择。": "The selected join request has expired. Choose again.",
  "无法删除所选恢复凭据；请检查浏览器存储设置后重试。":
    "Could not delete the selected recovery credentials. Check browser storage settings and try again.",
  "此浏览器保存了该房间的身份；请选择要恢复的身份，或以新身份进入。":
    "This browser saved identities for this room. Choose one to restore, or enter with a new identity.",
  "未命名": "Unnamed",
  "观众": "Spectator",
  "玩家": "Player",
  "加入房间失败。": "Could not join the room.",
  "多次重连仍未成功；网络恢复或回到本页时会自动重试，也可以忘记这个房间。":
    "Repeated reconnect attempts failed. It retries automatically when the network returns or you come back to this tab; you can also forget this room.",
});

function capturedTerm(value) {
  return ENGLISH_DYNAMIC[value] ?? value;
}

function clockCopy(clock) {
  const byoYomi = /^(\d+) 分钟 \+ (\d+)×(\d+) 秒$/u.exec(clock);
  if (byoYomi) return `${byoYomi[1]} min + ${byoYomi[2]}×${byoYomi[3]} sec`;
  const absolute = /^(\d+) 分钟$/u.exec(clock);
  if (absolute) return `${absolute[1]} min`;
  return capturedTerm(clock);
}

function capturedPhrase(rawValue) {
  const value = String(rawValue ?? "").trim();
  const exact = capturedTerm(value);
  if (exact !== value) return exact;
  for (const candidate of ENGLISH_PATTERNS) {
    if (
      !(candidate?.pattern instanceof RegExp) ||
      !["string", "function"].includes(typeof candidate.replace)
    ) {
      continue;
    }
    const pattern = new RegExp(candidate.pattern.source, candidate.pattern.flags);
    const translated = value.replace(pattern, candidate.replace);
    if (translated !== value) return translated;
  }
  return value;
}

/** "1 move" / "2 moves": English count phrases for a captured number. */
function countOf(count, singular, plural = `${singular}s`) {
  return `${count} ${String(count) === "1" ? singular : plural}`;
}

// "b10 · WEBGL · 搜索 120 次"-style lists of independently translated parts.
function segmentsPhrase(value) {
  return String(value ?? "").split(" · ").map((part) => capturedPhrase(part)).join(" · ");
}

const ANALYSIS_PREFIX = /^(观战局面|当前局面|第 (\d+) 手|整局分析 (\d+) \/ (\d+) · 第 (\d+) 手)$/u;

function analysisPrefixCopy(prefix) {
  const match = ANALYSIS_PREFIX.exec(prefix);
  if (!match) return capturedPhrase(prefix);
  if (match[1] === "观战局面") return "Spectator position";
  if (match[1] === "当前局面") return "Current position";
  if (match[2]) return `Move ${match[2]}`;
  return `Full-game analysis ${match[3]} / ${match[4]} · move ${match[5]}`;
}

const BOARD_GAMES = Object.freeze({ 围棋: "Go", 五子棋: "Gomoku", 黑白棋: "Othello" });

/** English for the board labels, one pattern per label with the game captured. */
function boardLabelPatterns() {
  const game = "(围棋|五子棋|黑白棋)";
  return [
    [`竹筒${game}的平面展开视图。左键点击落子；右键或触屏单指横向拖动改变展开起点。`,
      (name) => `Flat view of the cylinder ${name} board. Left-click to play; right-drag or drag horizontally with one finger to change the starting seam.`],
    [`甜甜圈${game}的平面展开视图。左键点击落子；右键或触屏单指向任意方向拖动改变展开起点。`,
      (name) => `Flat view of the torus ${name} board. Left-click to play; right-drag or drag in any direction with one finger to change the starting point.`],
    [`莫比乌斯${game}的平面展开视图。左键点击落子；右键或触屏单指横向滑过一圈后棋盘会上下翻转。`,
      (name) => `Flat view of the Möbius ${name} board. Left-click to play; right-drag or drag horizontally with one finger, and the board flips vertically after one lap.`],
    [`竹筒${game}的弧面视图。左键点击落子；右键或触屏单指横向拖动棋盘，滚轮或双指缩放。`,
      (name) => `Curved view of the cylinder ${name} board. Left-click to play; right-drag or drag horizontally with one finger to move the board, and use the wheel or pinch to zoom.`],
    [`左右相接的三维竹筒${game}棋盘。左键单击落子，右键拖动旋转，滚轮或双指缩放。`,
      (name) => `3D cylinder ${name} board with connected left and right edges. Left-click to play, right-drag to rotate, and use the wheel or pinch to zoom.`],
    [`上下左右均首尾相接的三维甜甜圈${game}棋盘。左键单击落子，右键拖动旋转，滚轮或双指缩放。`,
      (name) => `3D torus ${name} board with all four edges connected. Left-click to play, right-drag to rotate, and use the wheel or pinch to zoom.`],
    [`左右反向相接、上下保留一圈边界的三维莫比乌斯${game}棋盘。左键单击落子，右键拖动旋转，滚轮或双指缩放。`,
      (name) => `3D Möbius ${name} board with reversed left-right connection and one open boundary. Left-click to play, right-drag to rotate, and use the wheel or pinch to zoom.`],
    [`左右相连的竹筒${game}棋盘区域`, (name) => `Cylinder ${name} board with left and right joined`],
    [`上下左右相连的甜甜圈${game}棋盘区域`, (name) => `Torus ${name} board joined in both directions`],
    [`左右反向相连、上下保留边界的莫比乌斯${game}棋盘区域`,
      (name) => `Möbius ${name} board with a reversed horizontal seam and vertical boundary`],
    [`可旋转的3D竹筒${game}棋盘`, (name) => `Rotatable 3D cylinder ${name} board`],
    [`可旋转的3D甜甜圈${game}棋盘`, (name) => `Rotatable 3D torus ${name} board`],
    [`可旋转的3D莫比乌斯${game}棋盘`, (name) => `Rotatable 3D Möbius ${name} board`],
  ].map(([source, english]) => ({
    // The labels hold no regular-expression characters besides the game group.
    pattern: new RegExp(`^${source}$`, "u"),
    replace: (_, name) => english(BOARD_GAMES[name]),
  }));
}

export const ENGLISH_PATTERNS = Object.freeze([
  {
    pattern: /^(.+) 后按当前死子标记自动确认；修改标记会重新计时，点目最长 10 分钟。$/u,
    replace: "The count is confirmed with the current dead-stone marks in $1; changing a mark restarts the timer, and a count lasts at most 10 minutes.",
  },
  {
    pattern: /^点目时间到，已按当前死子标记自动确认：(.+)。$/u,
    replace: (_, result) => `Time ran out for the count, so the current dead-stone marks were confirmed: ${capturedPhrase(result)}.`,
  },
  {
    pattern: /^(黑方|白方)已离线$/u,
    replace: (_, color) => `${color === "黑方" ? "Black" : "White"} is offline`,
  },
  {
    pattern: /^离线满 2 分钟后可以判对方弃局，还需 (.+)；对方回来后照常继续。$/u,
    replace: "You can claim the game once your opponent has been offline for 2 minutes ($1 left); if they return, play goes on.",
  },
  {
    pattern: /^访客执白，AI 执黑（(.+)）· (.+)$/u,
    replace: (_, engine, summary) =>
      `Guest plays White, AI plays Black (${capturedPhrase(engine)}) · ${capturedPhrase(summary)}`,
  },
  {
    pattern: /^(\d+) × (\d+) · (竹筒|甜甜圈|莫比乌斯) · (中国规则|简化领地计分)(?: · 贴目 ([\d.]+))?(?: · (.+))?$/u,
    replace: (_, width, height, topology, rule, komi, clock) => {
      const komiCopy = komi ? ` · Komi ${komi}` : "";
      return `${width} × ${height} · ${capturedPhrase(topology)} · ${capturedPhrase(rule)}${komiCopy}${
        clock ? ` · ${clockCopy(clock)}` : ""
      }`;
    },
  },
  {
    pattern: /^(\d+) 分钟前$/u,
    replace: (_, minutes) => `${minutes} minute${minutes === "1" ? "" : "s"} ago`,
  },
  {
    pattern: /^(\d+) 小时前$/u,
    replace: (_, hours) => `${hours} hour${hours === "1" ? "" : "s"} ago`,
  },
  { pattern: /^房间 ([A-Z0-9]{6})$/u, replace: "Room $1" },
  { pattern: /^房间 ([A-Z0-9]{6}) 已经关闭；这是你在里面下的最后一盘。$/u, replace: "Room $1 has closed; this is the last game you played there." },
  // Accounts (src/app/account.js): names and addresses are kept as typed.
  { pattern: /^邮箱：(.+)（已验证）$/u, replace: "Email: $1 (confirmed)" },
  { pattern: /^邮箱：(.+)（未验证）$/u, replace: "Email: $1 (not confirmed)" },
  { pattern: /^重新发送（(\d+)）$/u, replace: "Resend ($1)" },
  { pattern: /^用户名已改成 (.+)。$/u, replace: "Your username is now $1." },
  {
    pattern: /^现在的邮箱：(.+)（已验证）。要更换的话，填新邮箱并收验证码确认。$/u,
    replace: "Your email: $1 (confirmed). To change it, enter a new one and confirm it with a code.",
  },
  {
    pattern: /^现在的邮箱：(.+)（未验证）。给它发一个验证码确认，或者换一个邮箱。$/u,
    replace: "Your email: $1 (not confirmed). Send it a code to confirm it, or use another one.",
  },
  // An address and its state (after the patterns above that also end so).
  { pattern: /^(.+)（已验证）$/u, replace: "$1 (confirmed)" },
  { pattern: /^(.+)（未验证）$/u, replace: "$1 (not confirmed)" },
  { pattern: /^验证码已发到 (.+)，10 分钟内有效。$/u, replace: "A code was sent to $1; it is valid for 10 minutes." },
  { pattern: /^注册成功，已登录：(.+)。$/u, replace: "Registered and signed in as $1." },
  { pattern: /^已用 Google 登录：(.+)。$/u, replace: "Signed in with Google as $1." },
  {
    pattern: /^已用 Google 登录。你的用户名是 (.+)，可以在账号设置里修改。$/u,
    replace: "Signed in with Google. Your username is $1; you can change it in account settings.",
  },
  {
    pattern: /^已用邮箱登录。你的用户名是 (.+)，可以在账号设置里修改。$/u,
    replace: "Signed in with your email. Your username is $1; you can change it in account settings.",
  },
  { pattern: /^已登录：(.+)。$/u, replace: "Signed in as $1." },
  {
    // Opening a saved game: "<black> 对 <white> · <result> · <n> 手".
    pattern: /^(.+) 对 (.+) · (.+) · (\d+) 手$/u,
    replace: (_, black, white, result, moves) =>
      `${capturedPhrase(black)} vs ${capturedPhrase(white)} · ${capturedPhrase(result)} · ${moves} move${moves === "1" ? "" : "s"}`,
  },
  { pattern: /^第 (\d+) 局$/u, replace: "Game $1" },
  {
    pattern: /^(\d+) 人观战 · (刚刚更新|\d+ 分钟前|\d+ 小时前)$/u,
    replace: (_, count, activity) => `${count} spectator${count === "1" ? "" : "s"} · ${capturedPhrase(activity)}`,
  },
  {
    pattern: /^显示 (\d+) \/ 共 (\d+) 个公开房间$/u,
    replace: (_, shown, total) => `Showing ${shown} of ${total} public room${total === "1" ? "" : "s"}`,
  },
  {
    pattern: /^共 (\d+) 个公开房间$/u,
    replace: (_, count) => `${count} public room${count === "1" ? "" : "s"}`,
  },
  {
    pattern: /^你将以(.+)认输，对方立即获胜；不需要对方确认，此操作不能撤销。$/u,
    replace: (_, loser) => `You will resign as ${capturedPhrase(loser)}. Your opponent wins immediately; no approval is required and this cannot be undone.`,
  },
  {
    pattern: /^你将以(.+?)向 (.+) 认输；AI 立即获胜，此操作不能撤销。$/u,
    replace: (_, loser, ai) => `You will resign as ${capturedPhrase(loser)} against ${capturedPhrase(ai)}. The AI wins immediately and this cannot be undone.`,
  },
  {
    pattern: /^(.+)将认输，(.+)立即获胜；此操作不能撤销。$/u,
    replace: (_, loser, winner) => `${capturedPhrase(loser)} will resign. ${capturedPhrase(winner)} wins immediately, and this cannot be undone.`,
  },
  {
    pattern: /^你执(黑|白) · AI 执(黑|白)$/u,
    replace: (_, human, ai) => `You play ${human === "黑" ? "Black" : "White"} · AI plays ${ai === "黑" ? "Black" : "White"}`,
  },
  {
    pattern: /^AI · (黑方|白方) · (.+)$/u,
    // A KataGo model ("b10") or a Gomoku/Othello difficulty ("普通").
    replace: (_, color, model) => `AI · ${capturedPhrase(color)} · ${capturedPhrase(model)}`,
  },
  // Board labels name the game shown (src/view/boardStyle.js, main.js).
  ...boardLabelPatterns(),
  {
    pattern: /^可加入 (\d+) · 正在进行 (\d+) · 等待开局 (\d+) · (\d+) 人观战 · (\d+) 位棋手在线$/u,
    replace: (_, joinable, playing, waiting, spectators, online) =>
      `${joinable} joinable · ${playing} in progress · ${waiting} waiting · ${spectators} watching · ${online} ${online === "1" ? "player" : "players"} online`,
  },
  {
    pattern: /^你还连着房间 ([A-Z0-9]+)；先退出房间再移除。$/u,
    replace: (_, code) => `You are still connected to room ${code}; leave the room before removing it.`,
  },
  {
    pattern: /^已从这台设备移除房间 ([A-Z0-9]+) 的记录。$/u,
    replace: (_, code) => `Removed room ${code} from this device.`,
  },
  {
    pattern: /^无法移除房间 ([A-Z0-9]+) 的记录，请检查浏览器存储设置。$/u,
    replace: (_, code) => `Room ${code} could not be removed from this device. Check the browser's storage settings.`,
  },
  {
    pattern: /^已复制房间 ([A-Z0-9]+) 的链接。$/u,
    replace: (_, code) => `Copied the link to room ${code}.`,
  },
  {
    pattern: /^房间链接：(.+)$/u,
    replace: (_, link) => `Room link: ${link}`,
  },
  {
    pattern: /^提示：AI 建议下在 (.+)（棋盘上已标出）。$/u,
    replace: (_, point) => `Hint: the AI suggests ${point} (marked on the board).`,
  },
  {
    pattern: /^(.+) 正在思考。你仍可旋转或切换视图。$/u,
    replace: (_, ai) => `${capturedPhrase(ai)} is thinking. You can still rotate or change views.`,
  },
  {
    pattern: /^(黑方|白方) AI 正在准备下一手。$/u,
    replace: (_, color) => `${capturedPhrase(color)} AI is preparing the next move.`,
  },
  {
    pattern: /^KataGo (正在思考|准备落子)$/u,
    replace: (_, state) => `KataGo ${state === "正在思考" ? "is thinking" : "is ready to move"}`,
  },
  {
    pattern: /^AI 自对弈已开始：黑白双方都由 (.+) 控制。$/u,
    replace: (_, ai) => `AI self-play started. ${capturedPhrase(ai)} controls both colors.`,
  },
  {
    pattern: /^AI 对局已开始：你执黑，(.+) 执白。$/u,
    replace: (_, ai) => `AI game started. You play Black; ${capturedPhrase(ai)} plays White.`,
  },
  {
    pattern: /^AI 对局已开始：(.+) 执黑，正在思考第一手。$/u,
    replace: (_, ai) => `AI game started. ${capturedPhrase(ai)} plays Black and is thinking about the first move.`,
  },
  {
    pattern: /^正在把 KataGo (.+) 接入在线白方座位…$/u,
    replace: "Attaching KataGo $1 to the online White seat…",
  },
  {
    pattern: /^(.+) 在线 AI 座位仍然保留；请保持房主页面在线，或打开 AI 设置重试\/更换模型。$/u,
    replace: (_, message) => `${capturedPhrase(message)} The online AI seat remains assigned. Keep the host page online, or open AI settings to retry or change the model.`,
  },
  {
    pattern: /^(.+) 已退出 AI 对局并保留当前棋局；现在可以本地轮流落子，或重新开始 KataGo 对局。$/u,
    replace: (_, message) => `${capturedPhrase(message)} The AI game ended but the position was kept. You can continue locally or invite KataGo again.`,
  },
  {
    pattern: /^(.+) 正在(房主浏览器中)?思考…$/u,
    replace: (_, ai, hostBrowser) =>
      `${capturedPhrase(ai)} is thinking${hostBrowser ? " in the host browser" : ""}…`,
  },
  {
    pattern: /^现在轮到 (.+) 思考；你仍然可以旋转和切换棋盘视图。$/u,
    replace: (_, ai) =>
      `It is ${capturedPhrase(ai)}'s turn to think. You can still rotate or change board views.`,
  },
  {
    pattern: /^KataGo 已完成判断(?:（推理 (\d+) ms）)?，正在由服务器验证并同步…$/u,
    replace: (_, inferenceMs) =>
      `KataGo finished evaluating${inferenceMs ? ` (${inferenceMs} ms inference)` : ""}. The server is validating and syncing the move…`,
  },
  {
    pattern: /^(黑方|白方) (.+?) 落子(?:，提掉 (\d+) 子)?(?:（神经判断 (\d+) ms）)?。$/u,
    replace: (_, color, ai, captured, inferenceMs) => {
      const captureCopy = captured
        ? ` and captures ${captured} stone${captured === "1" ? "" : "s"}`
        : "";
      const inferenceCopy = inferenceMs ? ` (${inferenceMs} ms neural evaluation)` : "";
      return `${capturedPhrase(color)} ${capturedPhrase(ai)} plays${captureCopy}${inferenceCopy}.`;
    },
  },
  {
    pattern: /^(黑方|白方) AI 停一手，另一方继续判断。$/u,
    replace: (_, color) => `${capturedPhrase(color)} AI passes. The other side will continue evaluating.`,
  },
  {
    pattern: /^(.+) 停一手，轮到你落子。$/u,
    replace: (_, ai) => `${capturedPhrase(ai)} passes. Your turn.`,
  },
  {
    pattern: /^(.+) 需要 WebGPU，当前浏览器无法运行。$/u,
    replace: (_, model) => `${capturedPhrase(model)} requires WebGPU and cannot run in this browser.`,
  },
  {
    pattern: /^(.+) · 胜率 (\d+)% · 访问 (\d+)%$/u,
    replace: (_, move, winRate, visits) =>
      `${capturedPhrase(move)} · win rate ${winRate}% · visits ${visits}%`,
  },
  {
    pattern: /^第 (\d+) 手已有 AI 参考(?: · (.+))?。$/u,
    replace: (_, move, detail) =>
      `Move ${move} has an AI review${detail ? ` · ${segmentsPhrase(detail)}` : ""}.`,
  },
  {
    pattern: /^(观战|当前)局面已有本地 AI 参考(?: · (.+))?。$/u,
    replace: (_, context, detail) =>
      `The ${context === "观战" ? "spectator" : "current"} position has a local AI review${detail ? ` · ${segmentsPhrase(detail)}` : ""}.`,
  },
  {
    pattern: /^(.+?) 首选搜索估值 (\d+)%（当前行棋方视角）。$/u,
    replace: (_, comparison, estimate) =>
      `${capturedPhrase(comparison)} Top-choice search estimate: ${estimate}% from the current player's perspective.`,
  },
  {
    pattern: /^(观战局面|当前局面|第 \d+ 手|整局分析 \d+ \/ \d+ · 第 \d+ 手) · (载入 KataGo .+|神经网络正在观察局面…|正在按.+规则短搜索…|正在准备分析…)$/u,
    replace: (_, prefix, stage) => `${analysisPrefixCopy(prefix)} · ${capturedPhrase(stage)}`,
  },
  {
    pattern: /^载入 KataGo (.+?) 模型（(.+?)）(.*)…$/u,
    replace: (_, model, size, progress) =>
      `Loading KataGo ${model} model (${capturedPhrase(size)})${progress}…`,
  },
  {
    pattern: /^正在按(竹筒|甜甜圈|莫比乌斯)规则短搜索…$/u,
    replace: (_, topology) => `Running a short search with ${capturedTerm(topology)} rules…`,
  },
  {
    pattern: /^(候选 \d+|自选点) · (.+)$/u,
    replace: (_, rank, move) => `${capturedPhrase(rank)} · ${capturedPhrase(move)}`,
  },
  {
    pattern: /^实战 (.+) 与 AI 首选一致。$/u,
    replace: "The played move $1 matches the AI's top choice.",
  },
  {
    pattern: /^实战 (.+) 是本次搜索候选第 (\d+)。$/u,
    replace: "The played move $1 ranked $2 among this search's candidates.",
  },
  {
    pattern: /^实战 (.+) 未进入本次 (\d+) 个已搜索候选；这不等于它一定是坏棋。$/u,
    replace: (_, move, count) =>
      `The played move ${move} was not among the ${countOf(count, "searched candidate")}; that does not necessarily make it a bad move.`,
  },
  {
    pattern: /^首选搜索估值 (\d+)%（当前行棋方视角）。$/u,
    replace: "Top-choice search estimate: $1% from the current player's perspective.",
  },
  {
    pattern: /^无法复制当前局面：(.+)$/u,
    replace: (_, reason) => `Could not copy the current position: ${capturedPhrase(reason)}`,
  },
  {
    pattern: /^无法建立本地分析分支：(.+)$/u,
    replace: (_, reason) => `Could not create the local analysis branch: ${capturedPhrase(reason)}`,
  },
  {
    pattern: /^AI (局势分析|复盘)暂时失败：(.+)$/u,
    replace: (_, kind, message) =>
      `AI ${kind === "局势分析" ? "position analysis" : "replay review"} failed temporarily: ${capturedPhrase(message)}`,
  },
  {
    pattern: /^AI (局势分析|复盘)线程没有正常启动：(.+)$/u,
    replace: (_, kind, message) =>
      `The AI ${kind === "局势分析" ? "position-analysis" : "replay-review"} worker did not start correctly: ${capturedPhrase(message)}`,
  },
  {
    pattern: /^无法重建第 (\d+) 手：(.+)$/u,
    replace: (_, move, reason) => `Could not rebuild move ${move}: ${capturedPhrase(reason)}`,
  },
  {
    pattern: /^已导出 (.+)。普通 SGF 阅读器可读取棋步；异形接缝保存在 X\* 扩展属性中。本局采用简化领地计分，双活中的眼仍计地。$/u,
    replace: "Exported $1. Standard SGF readers can read the moves; unusual-board seams are stored in X* extension properties. This game uses simplified territory scoring; seki eyes still count as territory.",
  },
  {
    pattern: /^已导出 (.+)。普通 SGF 阅读器可读取棋步；异形接缝保存在 X\* 扩展属性中。$/u,
    replace: "Exported $1. Standard SGF readers can read the moves; unusual-board seams are stored in X* extension properties.",
  },
  {
    pattern: /^已导出 (.+)。本局采用简化领地计分，双活中的眼仍计地。$/u,
    replace: "Exported $1. This game uses simplified territory scoring; seki eyes still count as territory.",
  },
  {
    pattern: /^兼容提示：(.+?)(?:（另有 (\d+) 项）)?。$/u,
    replace: (_, details, hiddenCount) => {
      const translatedDetails = details
        .split("；")
        .map((detail) => capturedPhrase(detail))
        .join("; ");
      return `Compatibility notes: ${translatedDetails}${hiddenCount ? ` (${hiddenCount} more)` : ""}.`;
    },
  },
  {
    pattern: /^已导入 (.+)，共 (\d+) 手；可播放、切换视图或做 AI 分析。(.*)$/u,
    replace: (_, filename, moves, notes) => {
      const noteCopy = notes.trim();
      return `Imported ${filename} with ${countOf(moves, "move")}. You can replay, change views, or run AI analysis.${noteCopy ? ` ${capturedPhrase(noteCopy)}` : ""}`;
    },
  },
  {
    pattern: /^已导入 (.+)，共 (\d+) 手；可播放或切换视图。(.*)$/u,
    replace: (_, filename, moves, notes) => {
      const noteCopy = notes.trim();
      return `Imported ${filename} with ${countOf(moves, "move")}. You can replay or change views.${noteCopy ? ` ${capturedPhrase(noteCopy)}` : ""}`;
    },
  },
  {
    pattern: /^已导入 (.+)：原谱未写异形拓扑，按当前选择的(竹筒|甜甜圈|莫比乌斯)复盘。(.*)$/u,
    replace: (_, filename, topology, notes) => {
      const noteCopy = notes.trim();
      return `Imported ${filename}. The SGF did not specify an unusual-board topology, so it will be replayed as the selected ${capturedPhrase(topology)}.${noteCopy ? ` ${capturedPhrase(noteCopy)}` : ""}`;
    },
  },
  {
    pattern: /^来自 (.+)；可随时切换(平面、弧面或立体视图|平面或立体视图)。$/u,
    replace: (_, source, views) =>
      `From ${capturedPhrase(source)}; you can switch to ${capturedPhrase(views)} at any time.`,
  },
  {
    pattern: /^可随时切换(平面、弧面或立体视图|平面或立体视图)。$/u,
    replace: (_, views) => `You can switch to ${capturedPhrase(views)} at any time.`,
  },
  {
    pattern: /^复盘结束：(.+)。认输结果已还原。$/u,
    replace: (_, result) => `Replay finished: ${capturedPhrase(result)}. The resignation result was restored.`,
  },
  {
    pattern: /^复盘结束：(.+)。最终死子标记与点目结果已还原。$/u,
    replace: (_, result) => `Replay finished: ${capturedPhrase(result)}. Final dead-stone marks and scoring were restored.`,
  },
  {
    pattern: /^复盘结束：SGF 记录结果 (.+)。普通 SGF 不包含本项目的异形死子判定过程。(.*)$/u,
    replace: (_, result, note) =>
      `Replay finished with SGF result ${result}. Standard SGF does not contain this project's unusual-board dead-stone adjudication.${note ? ` ${capturedPhrase(note)}` : ""}`,
  },
  {
    // Gomoku and Othello replays end without dead-stone scoring.
    pattern: /^复盘结束：(.+)。$/u,
    replace: (_, result) => `Replay finished: ${capturedPhrase(result)}.`,
  },
  {
    pattern: /^棋谱已播放到点目阶段，最终结果尚未确认。(.*)$/u,
    replace: (_, note) =>
      `The record has reached scoring, but the final result is not confirmed.${note ? ` ${capturedPhrase(note)}` : ""}`,
  },
  {
    pattern: /^这是复盘起点。(.*)$/u,
    replace: (_, note) =>
      `This is the start of the replay.${note ? ` ${capturedPhrase(note)}` : ""}`,
  },
  {
    pattern: /^第 (\d+) 手：(黑方|白方)停一手。(.*)$/u,
    replace: (_, move, color, note) =>
      `Move ${move}: ${capturedPhrase(color)} passes.${note ? ` ${capturedPhrase(note)}` : ""}`,
  },
  {
    pattern: /^第 (\d+) 手：(黑方|白方)落子(?:，提掉 (\d+) 子)?。(.*)$/u,
    replace: (_, move, color, captured, note) => {
      const captureCopy = captured
        ? ` and captures ${captured} stone${captured === "1" ? "" : "s"}`
        : "";
      return `Move ${move}: ${capturedPhrase(color)} plays${captureCopy}.${note ? ` ${capturedPhrase(note)}` : ""}`;
    },
  },
  {
    pattern: /^黑：活子 ([\d.]+) ＋ 地 ([\d.]+)；白：活子 ([\d.]+) ＋ 地 ([\d.]+) ＋ 贴目 ([\d.]+)；公气 ([\d.]+)$/u,
    replace: (_, blackStones, blackTerritory, whiteStones, whiteTerritory, komi, neutral) =>
      `Black: ${countOf(blackStones, "live stone")} + ${blackTerritory} territory; White: ${countOf(whiteStones, "live stone")} + ${whiteTerritory} territory + ${komi} komi; neutral: ${neutral}`,
  },
  {
    pattern: /^黑：地 ([\d.]+) ＋ 提子 ([\d.]+) ＋ 死子 ([\d.]+)；白：地 ([\d.]+) ＋ 提子 ([\d.]+) ＋ 死子 ([\d.]+) ＋ 贴目 ([\d.]+)；公气 ([\d.]+)$/u,
    replace: (_, blackTerritory, blackCaptures, blackDead, whiteTerritory, whiteCaptures, whiteDead, komi, neutral) =>
      `Black: ${blackTerritory} territory + ${countOf(blackCaptures, "capture")} + ${countOf(blackDead, "dead stone")}; White: ${whiteTerritory} territory + ${countOf(whiteCaptures, "capture")} + ${countOf(whiteDead, "dead stone")} + ${komi} komi; neutral: ${neutral}`,
  },
  {
    pattern: /^(黑方|白方)这块棋已(标为死子|恢复为活棋)。$/u,
    replace: (_, color, state) =>
      `${capturedPhrase(color)}'s group was ${state === "标为死子" ? "marked dead" : "restored as alive"}.`,
  },
  {
    pattern: /^点目完成：(.+)。$/u,
    replace: (_, result) => `Scoring complete: ${capturedPhrase(result)}.`,
  },
  {
    pattern: /^(\d+) × (\d+) (竹筒|甜甜圈|莫比乌斯)在线棋盘已准备好，黑方先行。$/u,
    replace: (_, width, height, topology) =>
      `${width} × ${height} ${capturedPhrase(topology)} online board is ready. Black plays first.`,
  },
  {
    pattern: /^将建立：竹筒（左右首尾相接） · (\d+) × (\d+)。当前对局进度将被清除。$/u,
    replace: "New board: Cylinder (left and right wrap) · $1 × $2. The current game progress will be cleared.",
  },
  {
    pattern: /^将建立：甜甜圈（上下左右首尾相接） · (\d+) × (\d+)。当前对局进度将被清除。$/u,
    replace: "New board: Torus (all four edges wrap) · $1 × $2. The current game progress will be cleared.",
  },
  {
    pattern: /^将建立：莫比乌斯（左右反向相接，上下保留一圈边界） · (\d+) × (\d+)。当前对局进度将被清除。$/u,
    replace: "New board: Möbius (left and right connect in reverse; top and bottom remain a boundary) · $1 × $2. The current game progress will be cleared.",
  },
  { pattern: /^第 (\d+) 手$/u, replace: "Move $1" },
  { pattern: /^(\d+) 手$/u, replace: (_, moves) => countOf(moves, "move") },
  { pattern: /^第 (\d+) \/ (\d+) 手$/u, replace: "Move $1 / $2" },
  { pattern: /^复盘 · 第 (\d+) \/ (\d+) 手$/u, replace: "Replay · move $1 / $2" },
  { pattern: /^(\d+) 手 · 对局结束$/u, replace: (_, moves) => `${countOf(moves, "move")} · game over` },
  { pattern: /^(\d+) 手 · 计时结束$/u, replace: (_, moves) => `${countOf(moves, "move")} · clock ended` },
  { pattern: /^候选 (\d+)$/u, replace: "Candidate $1" },
  { pattern: /^搜索 (\d+) 次$/u, replace: (_, count) => countOf(count, "search iteration") },
  { pattern: /^搜索访问占比 (\d+)%$/u, replace: "$1% of search visits" },
  { pattern: /^读秒 · 剩 (\d+) 次$/u, replace: (_, count) => `${countOf(count, "byo-yomi period")} left` },
  { pattern: /^其后 (\d+) × (\d+) 秒$/u, replace: "then $1 × $2 sec" },
  { pattern: /^(\d+) 分钟 \+ (\d+)×(\d+) 秒$/u, replace: "$1 min + $2×$3 sec" },
  {
    pattern: /^(.+)胜 · (.+)超时(。)?$/u,
    replace: (_, winner, loser, punctuated) =>
      `${capturedPhrase(winner)} wins · ${capturedPhrase(loser)} timed out${punctuated ? "." : ""}`,
  },
  {
    pattern: /^(.+)胜 · (.+)认输(。)?$/u,
    replace: (_, winner, loser, punctuated) =>
      `${capturedPhrase(winner)} wins · ${capturedPhrase(loser)} resigned${punctuated ? "." : ""}`,
  },
  {
    pattern: /^(.+)胜 ([\d.]+) 目(。)?$/u,
    replace: (_, winner, margin, punctuated) =>
      `${capturedPhrase(winner)} wins by ${margin} point${margin === "1" ? "" : "s"}${punctuated ? "." : ""}`,
  },
  { pattern: /^等待(.+)落子。$/u, replace: (_, color) => `Waiting for ${capturedPhrase(color)}.` },
  // "<AI> 准备落子" (an AI's turn card) before the generic "<colour>落子".
  {
    pattern: /^(黑方|白方) AI 准备落子$/u,
    replace: (_, color) => `${capturedTerm(color)} AI is ready to move`,
  },
  {
    pattern: /^(.+?) 准备落子$/u,
    replace: (_, ai) => `${capturedPhrase(ai)} is ready to move`,
  },
  { pattern: /^(.+)落子$/u, replace: (_, color) => `${capturedPhrase(color)} to play` },
  { pattern: /^(.+)落子。$/u, replace: (_, color) => `${capturedPhrase(color)} plays.` },
  { pattern: /^(.+)落子，提掉 (\d+) 子。$/u, replace: (_, color, count) => `${capturedPhrase(color)} plays and captures ${count} stone${count === "1" ? "" : "s"}.` },
  { pattern: /^(.+)停一手$/u, replace: (_, color) => `${capturedPhrase(color)} passes` },
  { pattern: /^(.+)停一手。$/u, replace: (_, color) => `${capturedPhrase(color)} passes.` },
  { pattern: /^(.+)停一手，轮到(.+)。$/u, replace: (_, color, next) => `${capturedPhrase(color)} passes. ${capturedPhrase(next)} to play.` },
  { pattern: /^(.+)第 (\d+) 手$/u, replace: (_, color, move) => `${capturedPhrase(color)} · move ${move}` },
  { pattern: /^(.+)申请撤回自己的上一手$/u, replace: (_, color) => `${capturedPhrase(color)} requests to take back their last move` },
  { pattern: /^(.+)申请撤回自己的上一手。$/u, replace: (_, color) => `${capturedPhrase(color)} requests to take back their last move.` },
  { pattern: /^(.+)申请撤回自己的上一手，请选择同意或拒绝。$/u, replace: (_, color) => `${capturedPhrase(color)} requests to take back their last move. Approve or decline.` },
  { pattern: /^已撤回(.+)的上一手。$/u, replace: (_, color) => `Undid ${capturedPhrase(color)}'s last move.` },
  { pattern: /^(.+)已确认当前点目，等待另一方。$/u, replace: (_, color) => `${capturedPhrase(color)} confirmed the score; waiting for the other player.` },
  { pattern: /^(.+)已确认；请核对后确认，或继续修改死子。$/u, replace: (_, color) => `${capturedPhrase(color)} confirmed. Review and confirm, or keep editing dead stones.` },
  { pattern: /^(.+) · (\d+) 人观战$/u, replace: (_, message, count) => `${capturedPhrase(message)} · ${countOf(count, "spectator")}` },
  { pattern: /^房间 ([A-Z0-9]{6}) 已创建，把邀请链接发给朋友吧。$/u, replace: "Room $1 created. Send the invitation link to your friend." },
  { pattern: /^房间 ([A-Z0-9]{6}) 已恢复上次建房请求，房主为 (.+)；请核对棋盘设置。$/u, replace: "Room $1 was recovered from the previous creation request. Host: $2. Check the board settings." },
  { pattern: /^房间 ([A-Z0-9]{6}) 已创建，但浏览器未保存房主凭据；请勿刷新，并检查浏览器存储设置。$/u, replace: "Room $1 was created, but your browser did not save the host credentials. Do not refresh; check browser storage settings." },
  { pattern: /^已放弃房间 ([A-Z0-9]{6}) 的恢复凭据；若房间已创建，将无法用原房主身份恢复。现在可按当前设置创建新房间。$/u, replace: "Discarded recovery credentials for room $1. If it already exists, its original host identity cannot be recovered. You can now create a room with the current settings." },
  { pattern: /^(.+) 已保留房间 ([A-Z0-9]{6}) 的建房凭据；可点击“核对并恢复”重试原请求。若要修改设置，请先放弃所选恢复凭据。$/u, replace: (_, reason, code) => `${capturedPhrase(reason)} Credentials for room ${code} were kept. Choose Check and recover to retry the original request. To change the settings, discard the selected recovery credentials first.` },
  { pattern: /^观战房间 ([A-Z0-9]{4,12})$/u, replace: "Watch room $1" },
  { pattern: /^加入房间 ([A-Z0-9]{4,12})$/u, replace: "Join room $1" },
  { pattern: /^已加入房间 ([A-Z0-9]{6})，你是(.+)。$/u, replace: (_, code, role) => `Joined room ${code} as ${capturedPhrase(role)}.` },
  { pattern: /^你已经在房间 ([A-Z0-9]{6}) 里，已回到原来的身份：(.+)。$/u, replace: (_, code, role) => `You were already in room ${code}; you are back as ${capturedPhrase(role)}.` },
  { pattern: /^已进入房间 ([A-Z0-9]{6})。$/u, replace: "Entered room $1." },
  { pattern: /^正在恢复房间 ([A-Z0-9]{6})…$/u, replace: "Restoring room $1…" },
  { pattern: /^邀请链接：(.+)$/u, replace: "Invitation link: $1" },
  { pattern: /^已选择 (\d+) × (\d+)；点击“新棋盘”后生效。$/u, replace: "Selected $1 × $2. Choose New board to apply." },
  { pattern: /^房间预览已更新为 (\d+) × (\d+)；邀请对局时会使用这套设置。$/u, replace: "Room preview updated to $1 × $2. The invitation will use these settings." },
  { pattern: /^下一局预览已更新为 (\d+) × (\d+)；确认后会使用这套设置。$/u, replace: "Next-game preview updated to $1 × $2. These settings will be used after confirmation." },
  { pattern: /^(\d+) × (\d+) (.+)棋盘已准备好，黑方先行。$/u, replace: (_, width, height, topology) => `${width} × ${height} ${capturedPhrase(topology)} board is ready. Black plays first.` },
  { pattern: /^(\d+) × (\d+) · (\d+) 点 · (.+)$/u, replace: (_, width, height, points, topology) => `${width} × ${height} · ${countOf(points, "point")} · ${capturedPhrase(topology)}` },
  { pattern: /^(\d+) × (\d+) 棋盘预览暂不可用$/u, replace: "$1 × $2 board preview is unavailable" },
  { pattern: /^(.+)棋盘规则说明$/u, replace: (_, topology) => `${capturedPhrase(topology)} board rules` },
  { pattern: /^📍 (.+) · 查看棋盘$/u, replace: "📍 $1 · Show on board" },
  { pattern: /^📍 (.+) · 上一块棋盘$/u, replace: "📍 $1 · Previous board" },
  { pattern: /^插入 (.+)$/u, replace: "Insert $1" },
  { pattern: /^发送表情包：(.+)$/u, replace: "Send sticker: $1" },
  { pattern: /^已在棋盘标出 📍 (.+)。$/u, replace: "Marked 📍 $1 on the board." },
  { pattern: /^已引用 📍 (.+)；发送后双方都能点击定位。$/u, replace: "Referenced 📍 $1. Both players can open it after you send." },
  { pattern: /^(.+) · 同机 · 在线$/u, replace: "$1 · same device · online" },
  { pattern: /^(.+) · 同机 · 暂时离线$/u, replace: "$1 · same device · temporarily offline" },
  { pattern: /^(.+) · 在线$/u, replace: "$1 · online" },
  { pattern: /^(.+) · 暂时离线$/u, replace: "$1 · temporarily offline" },
  { pattern: /^(.+) · AI · 房主页面在线$/u, replace: "$1 · AI · host page online" },
  { pattern: /^(.+) · AI · 等待房主页面$/u, replace: "$1 · AI · waiting for host page" },
  { pattern: /^已导出 (.+)。$/u, replace: "Exported $1." },
  { pattern: /^导入 SGF 失败：(.+)$/u, replace: (_, reason) => `SGF import failed: ${capturedPhrase(reason)}` },
  { pattern: /^导出 SGF 失败：(.+)$/u, replace: (_, reason) => `SGF export failed: ${capturedPhrase(reason)}` },
  { pattern: /^整局快速分析完成：共分析 (\d+) 个实战局面。$/u, replace: (_, count) => `Full-game analysis complete: ${countOf(count, "played position")} analyzed.` },
  { pattern: /^已切换到 (.+)；请重新分析当前局面。$/u, replace: "Switched to $1. Analyze this position again." },
  { pattern: /^已切换到 (.+)；不同模型的分析结果会分别保留。$/u, replace: "Switched to $1. Results from each model are kept separately." },
  {
    pattern: /^正在载入 KataGo (.+?) 神经网络 · (.+)…$/u,
    replace: (_, model, progress) =>
      `Loading KataGo ${model} neural network · ${progress.replace(/约 ([\d.]+) MB/u, "about $1 MB")}…`,
  },
  { pattern: /^KataGo 正在观察整盘棋 · (.+) 推理…$/u, replace: "KataGo is reading the full board · $1 inference…" },
  {
    pattern: /^神经判断完成，正在按(.+)规则验证与搜索…$/u,
    replace: (_, topology) =>
      `Neural evaluation complete. Validating and searching with ${capturedPhrase(topology)} rules…`,
  },
  {
    pattern: /^KataGo (\S+) (竹筒|甜甜圈|莫比乌斯)混合 AI$/u,
    replace: (_, model, topology) => `KataGo ${model} ${capturedTerm(topology)} hybrid AI`,
  },
  { pattern: /^KataGo (.+)混合 AI$/u, replace: (_, topology) => `KataGo ${capturedPhrase(topology)} hybrid AI` },
  {
    pattern: /^AI 自对弈已开始：黑方 (.+)，白方 (.+)。$/u,
    replace: (_, black, white) => `AI self-play started: Black ${black}, White ${white}.`,
  },
  { pattern: /^(\d+) 分钟$/u, replace: (_, minutes) => `${minutes} min` },
  {
    pattern: /^📍 (.+) 来自上一块 (\d+) × (\d+) (竹筒|甜甜圈|莫比乌斯)棋盘，当前不强行定位。$/u,
    replace: (_, label, width, height, topology) =>
      `📍 ${label} refers to the previous ${width} × ${height} ${capturedTerm(topology)} board, so it is not shown on this one.`,
  },
  {
    pattern: /^已引用 📍 (.+)；发送后当前频道可以点击定位。$/u,
    replace: "Referenced 📍 $1. People in this channel can jump to it after you send.",
  },
  {
    pattern: /^(.+) 提到了 📍 (.+)，已标记；点击坐标可转到该处。$/u,
    replace: "$1 mentioned 📍 $2. It is marked; select the coordinate to go there.",
  },
  {
    pattern: /^(黑方|白方) AI (正在思考|准备落子)$/u,
    replace: (_, color, state) =>
      `${capturedTerm(color)} AI ${state === "正在思考" ? "is thinking" : "is ready to move"}`,
  },
  {
    pattern: /^已暂停 · (黑方|白方)待行$/u,
    replace: (_, color) => `Paused · ${capturedTerm(color)} to move`,
  },
  {
    pattern: /^已在本页选择 (.+)；该分支不会发送到房间。$/u,
    replace: (_, move) => `Selected ${capturedPhrase(move)} on this page; this branch is never sent to the room.`,
  },
  {
    pattern: /^已撤回(黑方|白方) AI 的上一手；自对弈保持暂停。$/u,
    replace: (_, color) => `Undid ${capturedTerm(color)} AI's last move; self-play stays paused.`,
  },
  {
    pattern: /^(.+?) 已保留本次加入凭据；请使用下方“核对并恢复”重试原身份。$/u,
    replace: (_, reason) =>
      `${capturedPhrase(reason)} The credentials for this join were kept. Use Check and recover below to retry the original identity.`,
  },
  {
    pattern: /^(.+?) 此房间仍有其他可恢复的加入请求，请核对身份后再恢复。$/u,
    replace: (_, reason) =>
      `${capturedPhrase(reason)} This room has other recoverable join requests. Check the identity before recovering.`,
  },
  {
    pattern: /^正在以 (.+) 的身份恢复房间 ([A-Z0-9]{6})…$/u,
    replace: (_, name, code) => `Restoring room ${code} as ${capturedPhrase(name)}…`,
  },
  {
    pattern: /^(.+?)本地凭据未能删除，恢复入口可能再次出现；请检查浏览器存储设置。$/u,
    replace: (_, reason) =>
      `${capturedPhrase(reason)} The local credentials could not be deleted, so the recovery option may reappear. Check browser storage settings.`,
  },
  { pattern: /^棋谱结果 (.+)$/u, replace: "Recorded result $1" },
  { pattern: /^确认(黑方|白方)结果$/u, replace: (_, color) => `Confirm as ${capturedTerm(color)}` },
  { pattern: /^联机服务返回 (\d+)。$/u, replace: "The online service returned HTTP $1." },
  {
    pattern: /^(\d+) × (\d+) (竹筒|甜甜圈|莫比乌斯)$/u,
    replace: (_, width, height, topology) => `${width} × ${height} ${capturedTerm(topology)}`,
  },
  // Coordinate hint: "D4 · A列与末列相邻 · 点击引用到聊天（不会落子）".
  {
    pattern: /^([A-Z]{1,2}\d{1,2}) · (.+)$/u,
    replace: (_, coordinate, notes) => `${coordinate} · ${segmentsPhrase(notes)}`,
  },
  // Gomoku and Othello results, moves and settings (src/ui/gameUi.js).
  {
    pattern: /^(黑方|白方)连成五子获胜(。)?$/u,
    replace: (_, color, punctuated) =>
      `${capturedTerm(color)} wins with five in a row${punctuated ? "." : ""}`,
  },
  {
    pattern: /^(黑方|白方)以 (\d+) 子长连获胜(。)?$/u,
    replace: (_, color, length, punctuated) =>
      `${capturedTerm(color)} wins with an overline of ${length}${punctuated ? "." : ""}`,
  },
  {
    pattern: /^(黑方|白方)胜 (\d+) 子(。)?$/u,
    replace: (_, color, margin, punctuated) =>
      `${capturedTerm(color)} wins by ${countOf(margin, "disc")}${punctuated ? "." : ""}`,
  },
  {
    pattern: /^双方各 (\d+) 子，和棋(。)?$/u,
    replace: (_, count, punctuated) => `Draw: ${countOf(count, "disc")} each${punctuated ? "." : ""}`,
  },
  {
    pattern: /^(黑方|白方)无子可下，(黑方|白方)继续(。)?$/u,
    replace: (_, skipped, next, punctuated) =>
      `${capturedTerm(skipped)} has no legal move; ${capturedTerm(next)} continues${punctuated ? "." : ""}`,
  },
  {
    pattern: /^(黑方|白方)落子，翻转 (\d+) 子。$/u,
    replace: (_, color, flipped) => `${capturedTerm(color)} plays and flips ${countOf(flipped, "disc")}.`,
  },
  {
    pattern: /^第 (\d+) 手：(黑方|白方)落子，翻转 (\d+) 子。(.*)$/u,
    replace: (_, move, color, flipped, note) =>
      `Move ${move}: ${capturedTerm(color)} plays and flips ${countOf(flipped, "disc")}.${
        note.trim() ? ` ${capturedPhrase(note)}` : ""
      }`,
  },
  {
    pattern: /^对局结束：(.+)。$/u,
    replace: (_, result) => `Game over: ${capturedPhrase(result)}.`,
  },
  {
    pattern: /^(\d+) × (\d+) · (竹筒|甜甜圈|莫比乌斯) · (自由规则|禁手规则（连珠）)(?: · (.+))?$/u,
    replace: (_, width, height, topology, rule, clock) =>
      `${width} × ${height} · ${capturedTerm(topology)} · ${capturedTerm(rule)}${clock ? ` · ${clockCopy(clock)}` : ""}`,
  },
  {
    pattern: /^(\d+) × (\d+) · (竹筒|甜甜圈|莫比乌斯) · (不计时|\d+ 分钟(?: \+ \d+×\d+ 秒)?)$/u,
    replace: (_, width, height, topology, clock) =>
      `${width} × ${height} · ${capturedTerm(topology)} · ${clockCopy(clock)}`,
  },
  {
    pattern: /^(横向列数|纵向行数|偶数列|偶数行) · (\d+)–(\d+)$/u,
    replace: (_, axis, min, max) => `${{
      横向列数: "Columns",
      纵向行数: "Rows",
      偶数列: "Even columns",
      偶数行: "Even rows",
    }[axis]} · ${min}–${max}`,
  },
  {
    pattern: /^这份 SGF 不是围棋、五子棋或黑白棋棋谱（GM\[(.*)\]），无法导入。$/u,
    replace: "This SGF file is not a Go, Gomoku or Othello record (GM[$1]) and cannot be imported.",
  },
  // Gomoku and Othello AI (src/main.js): the engine's name ("Rapfi",
  // "拓扑黑白棋 AI") and difficulty are captured. Kept after the KataGo and
  // colour-specific sentences above, which they would otherwise shadow.
  {
    pattern: /^(.+) · (简单|普通|困难)$/u,
    replace: (_, engine, level) => `${capturedPhrase(engine)} · ${capturedTerm(level)}`,
  },
  {
    pattern: /^(简单|普通|困难) \/ (简单|普通|困难)$/u,
    replace: (_, black, white) => `${capturedTerm(black)} / ${capturedTerm(white)}`,
  },
  {
    pattern: /^(.+) · 自对弈$/u,
    replace: (_, engine) => `${capturedPhrase(engine)} · self-play`,
  },
  {
    pattern: /^(.+?) (正在思考|准备落子)$/u,
    replace: (_, engine, state) =>
      `${capturedPhrase(engine)} ${state === "正在思考" ? "is thinking" : "is ready to move"}`,
  },
  {
    pattern: /^正在把 (.+) 接入在线白方座位…$/u,
    replace: (_, engine) => `Attaching ${capturedPhrase(engine)} to the online White seat…`,
  },
  {
    pattern: /^和 (.+) 对弈，朋友可以观战$/u,
    replace: (_, engine) => `Play ${capturedPhrase(engine)} while friends spectate`,
  },
  {
    pattern: /^(.+) 同时控制黑白双方$/u,
    replace: (_, engine) => `${capturedPhrase(engine)} controls both Black and White`,
  },
  {
    pattern: /^(.+) 在浏览器运行，朋友可以观战$/u,
    replace: (_, engine) => `${capturedPhrase(engine)} runs in the browser while friends spectate`,
  },
  {
    pattern: /^(.+) 正在房主浏览器中思考；服务器会验证并同步棋步。$/u,
    replace: (_, engine) =>
      `${capturedPhrase(engine)} is thinking in the host browser; the server will validate and sync the move.`,
  },
  {
    pattern: /^(.+) 已选好落点，正在由服务器验证并同步…$/u,
    replace: (_, engine) =>
      `${capturedPhrase(engine)} chose its move. The server is validating and syncing it…`,
  },
  // Generic fallbacks: keep these last so the specific sentences win.
  {
    pattern: /^(围棋|五子棋|黑白棋) · (.+)$/u,
    replace: (_, game, rest) => `${capturedTerm(game)} · ${capturedPhrase(rest)}`,
  },
  {
    // Messages that join independent sentences ("A。 B。").
    pattern: /^(.+?。)\s+(\S[\s\S]*)$/u,
    replace: (_, first, rest) => `${capturedPhrase(first)} ${capturedPhrase(rest)}`,
  },
]);
