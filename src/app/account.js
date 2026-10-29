/**
 * The account behind this browser, laid out the usual way (as on OGS): the
 * top bar says "登录" and opens the sign-in dialog (Google first, then a
 * username and password, or a code sent by email), or shows the account's
 * name and opens a menu (My games, account settings, sign out). The
 * settings page (/settings) changes the username, lists the ways to sign in
 * (password, email codes, each bound Google account, which can be unbound
 * or another one bound), adds, confirms and changes the email (by code:
 * registering takes no email), sets a new password and deletes the account
 * (its username typed to confirm). A guest who registers or signs in keeps its games
 * (worker/auth.js adoptGuest). Someone who forgot their password signs in
 * with an email code and lands on the new password (worker/accounts.js).
 * The session lives in an HttpOnly cookie scripts cannot read; this page
 * only remembers the account's name, to show it before asking the server.
 *
 * main.js owns the page state; this module reads it through live bindings
 * (see the export list at the end of main.js).
 */

import {
  cleanEmail,
  cleanUsername,
  passwordAllowed,
} from "../multiplayer/accountRules.js";
import { localizedErrorMessage } from "../i18n.js";
import {
  elements,
  rememberPlayerName,
  roomClient,
  savedPlayerName,
  setMessage,
} from "../main.js";

const HINT_STORAGE_KEY = "topology-go-account-v1";
// Set before the page reloads after signing out ("1") or deleting the
// account ("deleted"), to say so afterwards.
const SIGNED_OUT_KEY = "topology-go-signed-out";
// Set before going to the settings page after signing in with a code
// because the password was forgotten.
const CODE_SIGNED_IN_KEY = "topology-go-code-signed-in";
const SEND_CODE_LABEL = "发送验证码";
const CODE_PATTERN = /^\d{6}$/u;
const SETTINGS_SECTIONS = ["account", "sign-in", "email", "password"];

// What the server last said: { guest, name, email, emailVerified,
// hasPassword, google }, or null for nobody.
let account = null;
let accountKnown = false;
let signInOptions = { passwords: true, google: false, emailCodes: false };
// "methods" (the ways to sign in, side by side), "sign-in" (a password),
// "register" or "code" (an email code).
let accountTab = "methods";
// The code was asked for under "forgot your password?": a new one next.
let codeForPassword = false;
let settingsSection = "account";
// A message for the settings page once it knows the account (after Google).
let settingsNotice = null;
// The Google account whose unbind button was pressed once (press again to confirm).
let armedUnlink = null;
let accountBusy = false;
let accountHooks = { beforeSignOut: async () => {}, changed: () => {} };
// The send-code buttons waiting before another code may be asked for.
const countdowns = new Map();

function readHint() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HINT_STORAGE_KEY) ?? "null");
    return typeof parsed?.name === "string" && parsed.name ? parsed : null;
  } catch {
    return null;
  }
}

function writeHint(summary) {
  try {
    if (summary && !summary.guest && summary.name) {
      window.localStorage.setItem(HINT_STORAGE_KEY, JSON.stringify({ name: summary.name }));
    } else {
      window.localStorage.removeItem(HINT_STORAGE_KEY);
    }
  } catch {
    // Without storage the button says "登录" until the server is asked.
  }
}

function signedInName() {
  if (account) return account.guest ? null : account.name;
  return readHint()?.name ?? null;
}

function signedIn() {
  return Boolean(account && !account.guest);
}

function renderAccountButton() {
  const name = signedInName();
  const button = elements.accountButton;
  const label = elements.accountButtonLabel;
  // A name is shown as typed, never translated.
  if (name) {
    label.setAttribute("data-i18n-ignore", "");
    label.textContent = name;
    button.title = name;
    button.setAttribute("aria-haspopup", "menu");
  } else {
    label.removeAttribute("data-i18n-ignore");
    label.textContent = "登录";
    button.removeAttribute("title");
    button.setAttribute("aria-haspopup", "dialog");
    closeAccountMenu();
  }
  elements.accountCaret.hidden = !name;
}

function renderGuestNote() {
  elements.recordsGuestNote.hidden = Boolean(signedInName());
}

/** The server's answer about this browser's user (also from the My games list). */
function accountSeen(summary) {
  if (!summary || typeof summary !== "object") {
    account = null;
  } else {
    // The My games list leaves the details out; keep the ones known.
    const known = account && !account.guest && account.name === summary.name ? account : {};
    account = {
      guest: summary.guest === true,
      name: summary.name ?? null,
      email: summary.email ?? null,
      emailVerified: summary.emailVerified ?? known.emailVerified ?? false,
      hasPassword: summary.hasPassword ?? known.hasPassword ?? true,
      google: Array.isArray(summary.google) ? summary.google : known.google ?? [],
    };
  }
  writeHint(account);
  renderAccountButton();
  renderGuestNote();
  if (elements.accountDialog.open) renderAccountDialog();
  if (!elements.settingsScreen.hidden) renderSettings();
}

async function refreshAccount() {
  try {
    const response = await fetch("/api/account", { credentials: "same-origin" });
    if (!response.ok) return false;
    const payload = await response.json();
    if (payload?.signIn) {
      signInOptions = {
        passwords: payload.signIn.passwords !== false,
        google: payload.signIn.google === true,
        emailCodes: payload.signIn.emailCodes === true,
      };
    }
    accountKnown = true;
    accountSeen(payload?.account ?? null);
    return true;
  } catch {
    return false;
  }
}

async function postAccount(path, body) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error(payload?.error ?? ""), { code: payload?.code, retryAfter: payload?.retryAfter });
  }
  return payload;
}

// --- The menu under the account's name ------------------------------------------

function renderAccountMenu() {
  elements.accountMenuName.textContent = account?.name ?? signedInName() ?? "";
  elements.accountMenuEmail.textContent = account?.email ?? "";
  elements.accountMenuEmail.hidden = !account?.email;
}

function openAccountMenu() {
  renderAccountMenu();
  elements.accountMenu.hidden = false;
  elements.accountButton.setAttribute("aria-expanded", "true");
  elements.accountMenu.querySelector(".account-menu-item")?.focus();
  // Fill in the email when only the remembered name was known.
  if (!accountKnown) void refreshAccount().then(renderAccountMenu);
}

function closeAccountMenu({ focusButton = false } = {}) {
  if (elements.accountMenu.hidden) return;
  elements.accountMenu.hidden = true;
  elements.accountButton.setAttribute("aria-expanded", "false");
  if (focusButton) elements.accountButton.focus();
}

function wireAccountMenu() {
  elements.accountButton.addEventListener("click", () => {
    if (!signedInName()) {
      openAccountDialog();
      return;
    }
    if (elements.accountMenu.hidden) openAccountMenu();
    else closeAccountMenu();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest?.(".account-menu-wrap")) closeAccountMenu();
  });
  elements.accountMenu.addEventListener("keydown", (event) => {
    const items = [...elements.accountMenu.querySelectorAll(".account-menu-item")];
    const index = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      closeAccountMenu({ focusButton: true });
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    }
  });
  elements.accountMenuSignOut.addEventListener("click", () => {
    closeAccountMenu();
    void signOut();
  });
}

// --- The sign-in dialog ---------------------------------------------------------

function showAccountError(message = "") {
  elements.accountError.textContent = message;
  elements.accountError.hidden = !message;
  if (message) showAccountInfo();
}

function showAccountInfo(message = "") {
  elements.accountInfo.textContent = message;
  elements.accountInfo.hidden = !message;
}

function setAccountBusy(busy) {
  accountBusy = busy;
  for (const root of [elements.accountForm, elements.settingsBody]) {
    for (const control of root.querySelectorAll("button, input")) {
      control.disabled = busy || control.dataset.waiting === "1";
    }
  }
}

/** Another code may be asked for in `seconds`: the send button counts down. */
function startResendCountdown(button, seconds = 60) {
  window.clearInterval(countdowns.get(button));
  let left = Math.max(1, Math.round(seconds));
  button.dataset.waiting = "1";
  const tick = () => {
    if (left <= 0) {
      window.clearInterval(countdowns.get(button));
      countdowns.delete(button);
      delete button.dataset.waiting;
      button.disabled = accountBusy;
      button.textContent = SEND_CODE_LABEL;
      return;
    }
    button.disabled = true;
    button.textContent = `重新发送（${left}）`;
    left -= 1;
  };
  tick();
  countdowns.set(button, window.setInterval(tick, 1_000));
}

const ACCOUNT_TITLES = { methods: "登录或注册", "sign-in": "登录", register: "注册账号", code: "邮箱验证码登录" };

/** Ways in besides a password (each also makes an account the first time). */
function otherSignInMethods() {
  return signInOptions.google || signInOptions.emailCodes;
}

/** The part of the dialog shown: with only passwords, straight to them. */
function shownAccountTab() {
  return accountTab === "methods" && !otherSignInMethods() ? "sign-in" : accountTab;
}

function renderAccountDialog() {
  const tab = shownAccountTab();
  for (const panel of elements.accountPanels) panel.hidden = panel.dataset.accountPanel !== tab;
  elements.accountTitle.textContent = ACCOUNT_TITLES[tab];
  elements.accountBack.hidden = tab === "methods" || !otherSignInMethods();
  elements.accountGuestNote.hidden = account?.guest !== true;
  elements.accountGoogleButton.hidden = !signInOptions.google;
  elements.accountMethodCode.hidden = !signInOptions.emailCodes;
  elements.accountUseCode.hidden = !signInOptions.emailCodes;
  elements.accountMethodsNote.hidden = !otherSignInMethods();
  if (signInOptions.google && signInOptions.emailCodes) {
    elements.accountMethodsNote.textContent = "第一次用 Google 或邮箱验证码登录，会自动注册一个账号。";
  } else if (otherSignInMethods()) {
    elements.accountMethodsNote.textContent = signInOptions.google
      ? "第一次用 Google 登录，会自动注册一个账号。"
      : "第一次用邮箱验证码登录，会自动注册一个账号。";
  }
  elements.accountCodeNote.textContent = codeForPassword
    ? "填账号的邮箱，我们发一个 6 位数验证码，10 分钟内有效。登录后可以直接设新密码。"
    : "填你的邮箱，我们发一个 6 位数验证码，10 分钟内有效。这个邮箱还没有账号的话，会自动注册一个。";
  elements.accountRegisterNote.textContent = signInOptions.emailCodes
    ? "注册后可以在账号设置里绑定邮箱：忘了密码时可以用它收验证码登录。"
    : "暂时还不能找回密码，请记好它。";
}

function showTab(tab, { forPassword = false } = {}) {
  accountTab = Object.hasOwn(ACCOUNT_TITLES, tab) ? tab : "methods";
  codeForPassword = accountTab === "code" && forPassword;
  showAccountError();
  showAccountInfo();
  renderAccountDialog();
}

/** Focus where the shown part of the dialog starts. */
function focusAccountTab() {
  const field = { "sign-in": elements.signInLogin, register: elements.registerUsername, code: elements.codeEmail }[shownAccountTab()];
  (field ?? elements.accountPanels.find((panel) => !panel.hidden)?.querySelector("button:not([hidden])"))?.focus();
}

function openAccountDialog(tab = "methods") {
  showTab(tab);
  if (!elements.accountDialog.open) elements.accountDialog.showModal();
  focusAccountTab();
  void refreshAccount().then(() => {
    if (!elements.accountDialog.open) return;
    // Signed in after all (this browser had forgotten the name): the menu.
    if (signedIn()) {
      closeAccountDialog();
      openAccountMenu();
      return;
    }
    renderAccountDialog();
  });
}

function clearSecrets() {
  for (const input of [
    elements.signInPassword, elements.registerPassword, elements.registerPasswordAgain,
    elements.codeInput, elements.settingsEmailCode,
    elements.settingsNewPassword, elements.settingsNewPasswordAgain,
  ]) {
    input.value = "";
  }
}

function closeAccountDialog() {
  if (elements.accountDialog.open) elements.accountDialog.close();
  clearSecrets();
  showAccountError();
  showAccountInfo();
}

/** A name for rooms: the account's, unless this browser already has one. */
function useAccountName(summary) {
  if (summary?.name && !savedPlayerName()) {
    rememberPlayerName(summary.name);
    if (!elements.playerName.value) elements.playerName.value = summary.name;
  }
}

/** Signed in (or registered): remember the account and use its name in rooms. */
function welcome(summary, message) {
  accountSeen(summary);
  useAccountName(summary);
  closeAccountDialog();
  setMessage(message);
  accountHooks.changed();
}

async function register() {
  const name = cleanUsername(elements.registerUsername.value);
  const password = elements.registerPassword.value;
  if (!name) {
    showAccountError("用户名要 2 到 20 个字，只能用中文、英文字母、数字和下划线。");
    elements.registerUsername.focus();
    return;
  }
  if (!passwordAllowed(password)) {
    showAccountError("密码要 8 到 128 个字符。");
    elements.registerPassword.focus();
    return;
  }
  if (password !== elements.registerPasswordAgain.value) {
    showAccountError("两次输入的密码不一样。");
    elements.registerPasswordAgain.focus();
    return;
  }
  const payload = await postAccount("/api/account/register", { username: name, password });
  welcome(payload.account, `注册成功，已登录：${payload.account?.name ?? name}。`);
}

async function signIn() {
  const login = elements.signInLogin.value.trim();
  const password = elements.signInPassword.value;
  if (!login || !password) {
    showAccountError("请填写用户名（或邮箱）和密码。");
    (login ? elements.signInPassword : elements.signInLogin).focus();
    return;
  }
  const payload = await postAccount("/api/account/sign-in", { login, password });
  welcome(payload.account, `已登录：${payload.account?.name ?? login}。`);
}

/** Ask for a code; a cap reached says when another may be asked for. */
async function requestCode(path, email, button) {
  try {
    const payload = await postAccount(path, { email });
    startResendCountdown(button, payload?.resendAfter ?? 60);
  } catch (error) {
    if (error.code === "EMAIL_COOLDOWN" && error.retryAfter) startResendCountdown(button, error.retryAfter);
    throw error;
  }
}

async function sendSignInCode() {
  const email = cleanEmail(elements.codeEmail.value);
  if (!email) {
    showAccountError("请填写邮箱。");
    elements.codeEmail.focus();
    return;
  }
  await requestCode("/api/account/email-code", email, elements.codeSend);
  showAccountInfo(`验证码已发到 ${email}，10 分钟内有效。`);
  elements.codeInput.focus();
}

/**
 * Signed in with a code, which makes the account for a new address. Under
 * "forgot your password?" it goes on to the new password in account
 * settings.
 */
async function signInWithCode() {
  const email = cleanEmail(elements.codeEmail.value);
  const code = elements.codeInput.value.trim();
  if (!email || !CODE_PATTERN.test(code)) {
    showAccountError("请填写邮箱和收到的 6 位数验证码。");
    (email ? elements.codeInput : elements.codeEmail).focus();
    return;
  }
  const payload = await postAccount("/api/account/email-sign-in", { email, code });
  const name = payload.account?.name ?? email;
  if (payload.created) {
    welcome(payload.account, `已用邮箱登录。你的用户名是 ${name}，可以在账号设置里修改。`);
    return;
  }
  if (!codeForPassword) {
    welcome(payload.account, `已登录：${name}。`);
    return;
  }
  clearSecrets();
  accountSeen(payload.account);
  useAccountName(payload.account);
  try {
    window.sessionStorage.setItem(CODE_SIGNED_IN_KEY, "1");
  } catch {
    // The settings page then just opens on the account.
  }
  window.location.assign("/settings#password");
}

/** Run one of the dialog's or the settings page's actions: busy meanwhile, its error shown. */
async function runAction(action, { fallback = "暂时无法登录，请稍后再试。", showError = showAccountError } = {}) {
  if (accountBusy) return;
  showError();
  setAccountBusy(true);
  try {
    await action();
  } catch (error) {
    showError(localizedErrorMessage(error, fallback));
  } finally {
    setAccountBusy(false);
  }
}

/** Enter in the dialog: the action of the part being filled in. */
function submitAccountForm() {
  const area = document.activeElement?.closest?.("[data-account-enter]")?.dataset.accountEnter;
  if (area === "code") {
    const typingCode = document.activeElement === elements.codeInput || elements.codeInput.value;
    return runAction(typingCode ? signInWithCode : sendSignInCode);
  }
  const tab = shownAccountTab();
  if (tab === "methods") return undefined;
  return runAction(tab === "register" ? register : signIn);
}

/**
 * Signed out (or the account deleted): this browser forgets the account and
 * its seats in rooms, then starts over and says why (handleAccountReturn).
 */
function forgetThisBrowser(reason) {
  writeHint(null);
  roomClient.disconnect({ preserveSession: true });
  for (const code of new Set(roomClient.listAllStoredSessions().map((entry) => entry.code))) {
    roomClient.forgetStoredSessions(code);
  }
  try {
    window.sessionStorage.setItem(SIGNED_OUT_KEY, reason);
  } catch {
    // The page still starts over; it just does not say why.
  }
  window.location.assign("/single");
}

/**
 * Sign out: this browser forgets the account and its seats in rooms (on a
 * shared computer nobody else can go on with your games), then starts over.
 * Signing in again, here or anywhere, brings the seats back.
 */
async function signOut() {
  if (accountBusy) return;
  setAccountBusy(true);
  try {
    await accountHooks.beforeSignOut();
    await postAccount("/api/account/sign-out");
  } catch (error) {
    setAccountBusy(false);
    const message = localizedErrorMessage(error, "暂时无法退出登录，请稍后再试。");
    setMessage(message, true);
    showSettingsError(message);
    return;
  }
  forgetThisBrowser("1");
}

async function startGoogleSignIn() {
  if (accountBusy) return;
  showAccountError();
  setAccountBusy(true);
  try {
    const { url } = await postAccount("/api/account/google", { returnTo: window.location.pathname });
    window.location.assign(url);
  } catch (error) {
    setAccountBusy(false);
    showAccountError(localizedErrorMessage(error, "暂时不能用 Google 登录。"));
  }
}

// --- Account settings (/settings) -----------------------------------------------

function showSettingsError(message = "") {
  elements.settingsError.textContent = message;
  elements.settingsError.hidden = !message;
  if (message) showSettingsInfo();
}

function showSettingsInfo(message = "") {
  elements.settingsInfo.textContent = message;
  elements.settingsInfo.hidden = !message;
}

function emailFact() {
  if (!account?.email) return "没有填邮箱";
  return account.emailVerified ? `${account.email}（已验证）` : `${account.email}（未验证）`;
}

/** One way to sign in: what it is, how it is set, and what can be done. */
function methodRow(label, detail, action = null) {
  const item = document.createElement("li");
  item.className = "settings-method";
  const text = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = label;
  const value = document.createElement("span");
  value.textContent = detail.text;
  // Addresses are shown as they are, never translated.
  if (detail.address) value.setAttribute("data-i18n-ignore", "");
  text.append(title, value);
  item.append(text);
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = action.danger ? "secondary-button danger-button" : "secondary-button";
    button.textContent = action.label;
    Object.assign(button.dataset, action.data);
    item.append(button);
  }
  return item;
}

function renderSignInMethods() {
  const rows = [methodRow("用户名和密码", { text: account.hasPassword ? "已设置" : "还没有密码" }, {
    label: account.hasPassword ? "修改密码" : "设置密码",
    data: { settingsGo: "password" },
  })];
  if (signInOptions.emailCodes) {
    const confirmed = account.email && account.emailVerified;
    rows.push(methodRow("邮箱验证码", confirmed ? { text: account.email, address: true } : { text: "还没有绑定邮箱" }, {
      label: confirmed ? "更换邮箱" : "绑定邮箱",
      data: { settingsGo: "email" },
    }));
  }
  for (const google of account.google ?? []) {
    rows.push(methodRow("Google", google.email ? { text: google.email, address: true } : { text: "Google 账号" }, {
      label: armedUnlink === google.id ? "确认解绑" : "解绑",
      danger: true,
      data: { unlinkGoogle: google.id },
    }));
  }
  elements.settingsMethods.replaceChildren(...rows);
  elements.settingsLinkGoogleRow.hidden = !signInOptions.google;
}

function renderSettings() {
  const known = signedIn();
  elements.settingsSignedOut.hidden = known || !accountKnown;
  elements.settingsBody.hidden = !known;
  if (!known) {
    elements.settingsTitle.removeAttribute("data-i18n-ignore");
    elements.settingsTitle.textContent = "账号设置";
    return;
  }
  elements.settingsTitle.setAttribute("data-i18n-ignore", "");
  elements.settingsTitle.textContent = account.name ?? "";
  for (const button of elements.settingsSectionButtons) {
    const active = button.dataset.settingsSection === settingsSection;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", String(active));
  }
  for (const panel of elements.settingsPanels) panel.hidden = panel.dataset.settingsPanel !== settingsSection;

  elements.settingsUsername.textContent = account.name ?? "";
  renderSignInMethods();
  elements.settingsEmailFact.textContent = emailFact();
  elements.settingsPasswordFact.textContent = account.hasPassword
    ? "已设置"
    : "还没有密码（只能用邮箱验证码或 Google 登录）";

  elements.settingsEmailState.textContent = !account.email
    ? "还没有填邮箱。填一个并收验证码确认后，忘了密码时可以用它登录。"
    : account.emailVerified
      ? `现在的邮箱：${account.email}（已验证）。要更换的话，填新邮箱并收验证码确认。`
      : `现在的邮箱：${account.email}（未验证）。给它发一个验证码确认，或者换一个邮箱。`;
  elements.settingsEmailOff.hidden = signInOptions.emailCodes;
  elements.settingsEmailForm.hidden = !signInOptions.emailCodes;
  elements.settingsEmailLabel.textContent = account.email && !account.emailVerified ? "邮箱" : "新邮箱";

  // Signed in is enough: no current password (owner's decision, 2026-10-28).
  elements.settingsPasswordNote.textContent = account.hasPassword
    ? "直接设新密码就行，不用输旧密码。改好后，其他设备上的登录会退出。"
    : "你的账号还没有密码。设好以后也可以用用户名和密码登录；其他设备上的登录会退出。";
}

function showSettingsSection(section, { focus = true } = {}) {
  settingsSection = SETTINGS_SECTIONS.includes(section) ? section : "account";
  showSettingsError();
  showSettingsInfo();
  if (window.location.pathname === "/settings") {
    const hash = settingsSection === "account" ? "" : `#${settingsSection}`;
    window.history.replaceState(window.history.state, "", `/settings${hash}`);
  }
  renderSettings();
  if (!focus || elements.settingsBody.hidden) return;
  if (settingsSection === "email" && !elements.settingsEmailForm.hidden) {
    if (account?.email && !account.emailVerified && !elements.settingsEmailInput.value) {
      elements.settingsEmailInput.value = account.email;
    }
    elements.settingsEmailInput.focus();
  } else if (settingsSection === "password") {
    elements.settingsNewPassword.focus();
  }
}

/** The settings page opened (main.js showAppScreen). */
function showSettingsScreen() {
  let codeSignedIn = false;
  try {
    codeSignedIn = window.sessionStorage.getItem(CODE_SIGNED_IN_KEY) === "1";
    window.sessionStorage.removeItem(CODE_SIGNED_IN_KEY);
  } catch {
    // Nothing to say.
  }
  settingsSection = SETTINGS_SECTIONS.includes(window.location.hash.slice(1))
    ? window.location.hash.slice(1)
    : "account";
  renderSettings();
  void refreshAccount().then(() => {
    showSettingsSection(settingsSection, { focus: codeSignedIn || settingsSection !== "account" });
    if (codeSignedIn && signedIn()) showSettingsInfo("已登录。忘了密码的话，现在就可以直接设一个新密码。");
    showSettingsNotice();
  });
}

/** Say how binding a Google account went (back from Google). */
function showSettingsNotice() {
  if (!settingsNotice || !signedIn()) return;
  const { text, error } = settingsNotice;
  settingsNotice = null;
  if (error) showSettingsError(text);
  else showSettingsInfo(text);
}

async function saveUsername() {
  const name = cleanUsername(elements.settingsUsernameInput.value);
  if (!name) {
    showSettingsError("用户名要 2 到 20 个字，只能用中文、英文字母、数字和下划线。");
    elements.settingsUsernameInput.focus();
    return;
  }
  const payload = await postAccount("/api/account/username", { username: name });
  elements.settingsUsernameInput.value = "";
  accountSeen(payload.account);
  showSettingsInfo(`用户名已改成 ${name}。`);
}

async function deleteOwnAccount() {
  const username = elements.settingsDeleteUsername.value.trim();
  if (!username) {
    showSettingsError("请输入你的用户名，确认要删除这个账号。");
    elements.settingsDeleteUsername.focus();
    return;
  }
  await postAccount("/api/account/delete", { username });
  forgetThisBrowser("deleted");
}

async function linkGoogle() {
  const { url } = await postAccount("/api/account/google/link");
  window.location.assign(url);
}

async function unlinkGoogle(id) {
  const payload = await postAccount("/api/account/google/unlink", { id });
  armedUnlink = null;
  accountSeen(payload.account);
  showSettingsInfo("已解绑这个 Google 账号。");
}

async function sendEmailCode() {
  const email = cleanEmail(elements.settingsEmailInput.value);
  if (!email) {
    showSettingsError("请填写邮箱。");
    elements.settingsEmailInput.focus();
    return;
  }
  await requestCode("/api/account/email", email, elements.settingsEmailSend);
  showSettingsInfo(`验证码已发到 ${email}，10 分钟内有效。`);
  elements.settingsEmailCode.focus();
}

async function confirmEmail() {
  const email = cleanEmail(elements.settingsEmailInput.value);
  const code = elements.settingsEmailCode.value.trim();
  if (!email || !CODE_PATTERN.test(code)) {
    showSettingsError("请填写邮箱和收到的 6 位数验证码。");
    (email ? elements.settingsEmailCode : elements.settingsEmailInput).focus();
    return;
  }
  const payload = await postAccount("/api/account/email/confirm", { email, code });
  elements.settingsEmailCode.value = "";
  elements.settingsEmailInput.value = "";
  accountSeen(payload.account);
  showSettingsInfo("邮箱已验证。");
}

async function saveNewPassword() {
  const password = elements.settingsNewPassword.value;
  if (!passwordAllowed(password)) {
    showSettingsError("密码要 8 到 128 个字符。");
    elements.settingsNewPassword.focus();
    return;
  }
  if (password !== elements.settingsNewPasswordAgain.value) {
    showSettingsError("两次输入的密码不一样。");
    elements.settingsNewPasswordAgain.focus();
    return;
  }
  const payload = await postAccount("/api/account/password", { password });
  clearSecrets();
  accountSeen(payload.account);
  showSettingsInfo("新密码已保存，其他设备上的登录已经退出。");
}

function wireSettings() {
  const settingsAction = (action, fallback) =>
    runAction(action, { fallback, showError: showSettingsError });
  for (const button of elements.settingsSectionButtons) {
    button.addEventListener("click", () => showSettingsSection(button.dataset.settingsSection));
  }
  // /settings#email and #password open those sections, also from the address bar.
  window.addEventListener("hashchange", () => {
    if (elements.settingsScreen.hidden) return;
    const section = window.location.hash.slice(1) || "account";
    if (section !== settingsSection) showSettingsSection(section);
  });
  elements.settingsSignIn.addEventListener("click", () => openAccountDialog());
  elements.settingsSignOut.addEventListener("click", () => void signOut());
  elements.settingsEmailSend.addEventListener("click", () =>
    void settingsAction(sendEmailCode, "暂时无法验证邮箱，请稍后再试。"));
  elements.settingsEmailForm.addEventListener("submit", (event) => {
    event.preventDefault();
    // Enter in the email field asks for a code; in the code field, confirms.
    const action = document.activeElement === elements.settingsEmailInput && !elements.settingsEmailCode.value
      ? sendEmailCode
      : confirmEmail;
    void settingsAction(action, "暂时无法验证邮箱，请稍后再试。");
  });
  elements.settingsPasswordForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void settingsAction(saveNewPassword, "暂时无法保存密码，请稍后再试。");
  });
  elements.settingsUsernameForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void settingsAction(saveUsername, "暂时无法修改用户名，请稍后再试。");
  });
  elements.settingsDeleteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void settingsAction(deleteOwnAccount, "暂时无法删除账号，请稍后再试。");
  });
  elements.settingsLinkGoogle.addEventListener("click", () =>
    void settingsAction(linkGoogle, "暂时不能绑定 Google 账号。"));
  elements.settingsMethods.addEventListener("click", (event) => {
    const go = event.target.closest?.("[data-settings-go]");
    if (go) {
      showSettingsSection(go.dataset.settingsGo);
      return;
    }
    const unlink = event.target.closest?.("[data-unlink-google]");
    if (!unlink) return;
    // Two presses: the first asks to confirm.
    const id = unlink.dataset.unlinkGoogle;
    if (armedUnlink !== id) {
      armedUnlink = id;
      renderSignInMethods();
      return;
    }
    void settingsAction(() => unlinkGoogle(id), "暂时无法解绑，请稍后再试。");
  });
}

/**
 * Coming back from Google, or from signing out: say how it went and take
 * the marker off the address. `url` is the address the page opened with.
 */
function handleAccountReturn(url) {
  let signedOut = null;
  try {
    signedOut = window.sessionStorage.getItem(SIGNED_OUT_KEY);
    window.sessionStorage.removeItem(SIGNED_OUT_KEY);
  } catch {
    // Nothing to report.
  }
  if (signedOut === "deleted") setMessage("账号已删除。");
  else if (signedOut) setMessage("已退出登录。这个浏览器不再保留你的账号和房间身份。");
  const binding = url.searchParams.get("google");
  if (binding === "linked" || binding === "link-failed") {
    const current = new URL(window.location.href);
    for (const key of ["google", "error", "error_description"]) current.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", `${current.pathname}${current.search}#sign-in`);
    settingsSection = "sign-in";
    settingsNotice = binding === "linked"
      ? { text: "Google 账号已绑定。" }
      : {
          error: true,
          text: url.searchParams.get("error") === "account_already_linked_to_different_user"
            ? "这个 Google 账号已经绑定在另一个账号上了。先在那个账号里解绑，或者直接用它登录那个账号。"
            : "绑定 Google 没有完成，请再试一次。",
        };
    // The settings page shows it once it knows the account.
    if (accountKnown) showSettingsNotice();
    return;
  }
  const succeeded = url.searchParams.has("signed-in");
  const failed = url.searchParams.has("sign-in-failed");
  if (!succeeded && !failed) return;
  const current = new URL(window.location.href);
  for (const key of ["signed-in", "sign-in-failed", "error", "error_description"]) current.searchParams.delete(key);
  window.history.replaceState(window.history.state, "", `${current.pathname}${current.search}${current.hash}`);
  if (failed) {
    setMessage(url.searchParams.get("error") === "account_not_linked"
      ? "这个 Google 邮箱已经属于一个用密码注册的账号；请用那个账号的用户名和密码登录。"
      : "Google 登录没有完成，请再试一次。", true);
    return;
  }
  void refreshAccount().then((known) => {
    if (known && account && !account.guest) {
      // A new account: say what username it was given (and that it can change).
      setMessage(url.searchParams.get("signed-in") === "google-new"
        ? `已用 Google 登录。你的用户名是 ${account.name}，可以在账号设置里修改。`
        : `已用 Google 登录：${account.name}。`);
      accountHooks.changed();
    } else {
      setMessage("Google 登录没有完成，请再试一次。", true);
    }
  });
}

/** Wire the button and its menu, the dialog, the settings page and the guest note. */
function wireAccount(hooks = {}) {
  accountHooks = { ...accountHooks, ...hooks };
  renderAccountButton();
  renderGuestNote();
  wireAccountMenu();
  wireSettings();
  elements.recordsRegister.addEventListener("click", () => openAccountDialog());
  for (const button of elements.accountGoButtons) {
    button.addEventListener("click", () => {
      showTab(button.dataset.accountGo);
      focusAccountTab();
    });
  }
  elements.accountUseCode.addEventListener("click", () => {
    const login = elements.signInLogin.value.trim();
    if (login.includes("@") && !elements.codeEmail.value) elements.codeEmail.value = login;
    showTab("code", { forPassword: true });
    focusAccountTab();
  });
  elements.accountForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitAccountForm();
  });
  elements.codeSend.addEventListener("click", () => void runAction(sendSignInCode));
  elements.codeSignIn.addEventListener("click", () => void runAction(signInWithCode));
  elements.accountCancel.addEventListener("click", closeAccountDialog);
  elements.accountGoogleButton.addEventListener("click", () => void startGoogleSignIn());
  elements.accountDialog.addEventListener("close", () => {
    showAccountError();
    showAccountInfo();
  });
}

export {
  accountSeen,
  handleAccountReturn,
  showSettingsScreen,
  wireAccount,
};
