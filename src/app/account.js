/**
 * The account behind this browser: the top bar button and its dialog to
 * sign in, register and sign out, Google sign-in when the site has it, and
 * the guest note on My games. A guest who registers or signs in keeps its
 * games (worker/auth.js adoptGuest). The session lives in an HttpOnly
 * cookie scripts cannot read; this page only remembers the account's name,
 * to show it before asking the server.
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
// Set before the page reloads after signing out, to say so afterwards.
const SIGNED_OUT_KEY = "topology-go-signed-out";

// What the server last said: { guest, name, email }, or null for nobody.
let account = null;
let signInOptions = { passwords: true, google: false };
let accountTab = "sign-in";
let accountBusy = false;
let accountHooks = { beforeSignOut: async () => {}, changed: () => {} };

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

function renderAccountButton() {
  const name = signedInName();
  const button = elements.accountButton;
  // A name is shown as typed, never translated.
  if (name) {
    button.setAttribute("data-i18n-ignore", "");
    button.textContent = name;
    button.title = name;
  } else {
    button.removeAttribute("data-i18n-ignore");
    button.textContent = "登录";
    button.removeAttribute("title");
  }
}

function renderGuestNote() {
  elements.recordsGuestNote.hidden = Boolean(signedInName());
}

/** The server's answer about this browser's user (also from the My games list). */
function accountSeen(summary) {
  account = summary && typeof summary === "object"
    ? { guest: summary.guest === true, name: summary.name ?? null, email: summary.email ?? null }
    : null;
  writeHint(account);
  renderAccountButton();
  renderGuestNote();
  if (elements.accountDialog.open) renderAccountDialog();
}

async function refreshAccount() {
  try {
    const response = await fetch("/api/account", { credentials: "same-origin" });
    if (!response.ok) return false;
    const payload = await response.json();
    if (payload?.signIn) signInOptions = { passwords: payload.signIn.passwords !== false, google: payload.signIn.google === true };
    accountSeen(payload?.account ?? null);
    return true;
  } catch {
    return false;
  }
}

function showAccountError(message = "") {
  elements.accountError.textContent = message;
  elements.accountError.hidden = !message;
}

function setAccountBusy(busy) {
  accountBusy = busy;
  for (const control of elements.accountForm.querySelectorAll("button, input")) control.disabled = busy;
}

function renderAccountDialog() {
  const signedIn = Boolean(account && !account.guest);
  elements.accountSignedIn.hidden = !signedIn;
  elements.accountForms.hidden = signedIn;
  elements.accountCancelRow.hidden = signedIn;
  elements.accountTitle.textContent = signedIn ? "你的账号" : "登录或注册";
  if (signedIn) {
    elements.accountName.textContent = account.name ?? "";
    elements.accountEmail.textContent = account.email ? `邮箱：${account.email}` : "没有填邮箱。";
    return;
  }
  for (const button of elements.accountTabButtons) {
    const active = button.dataset.accountTab === accountTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  for (const panel of elements.accountPanels) panel.hidden = panel.dataset.accountPanel !== accountTab;
  elements.accountGuestNote.hidden = account?.guest !== true;
  elements.accountGoogle.hidden = !signInOptions.google;
}

function openAccountDialog(tab = "sign-in") {
  accountTab = tab === "register" ? "register" : "sign-in";
  showAccountError();
  renderAccountDialog();
  if (!elements.accountDialog.open) elements.accountDialog.showModal();
  (accountTab === "register" ? elements.registerUsername : elements.signInLogin).focus();
  void refreshAccount().then(() => {
    if (elements.accountDialog.open) renderAccountDialog();
  });
}

function closeAccountDialog() {
  if (elements.accountDialog.open) elements.accountDialog.close();
  for (const input of [elements.signInPassword, elements.registerPassword, elements.registerPasswordAgain]) {
    input.value = "";
  }
  showAccountError();
}

async function postAccount(path, body) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(payload?.error ?? ""), { code: payload?.code });
  return payload;
}

/** Signed in (or registered): remember the account and use its name in rooms. */
function welcome(summary, message) {
  accountSeen(summary);
  if (summary?.name && !savedPlayerName()) {
    rememberPlayerName(summary.name);
    if (!elements.playerName.value) elements.playerName.value = summary.name;
  }
  closeAccountDialog();
  setMessage(message);
  accountHooks.changed();
}

async function register() {
  const name = cleanUsername(elements.registerUsername.value);
  const password = elements.registerPassword.value;
  const email = cleanEmail(elements.registerEmail.value);
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
  if (email === null) {
    showAccountError("邮箱格式不正确；不想填可以空着。");
    elements.registerEmail.focus();
    return;
  }
  const payload = await postAccount("/api/account/register", { username: name, password, email });
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

async function submitAccountForm() {
  if (accountBusy) return;
  showAccountError();
  setAccountBusy(true);
  try {
    if (accountTab === "register") await register();
    else await signIn();
  } catch (error) {
    showAccountError(localizedErrorMessage(error, "暂时无法登录，请稍后再试。"));
  } finally {
    setAccountBusy(false);
  }
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
    showAccountError(localizedErrorMessage(error, "暂时无法退出登录，请稍后再试。"));
    return;
  }
  writeHint(null);
  roomClient.disconnect({ preserveSession: true });
  for (const code of new Set(roomClient.listAllStoredSessions().map((entry) => entry.code))) {
    roomClient.forgetStoredSessions(code);
  }
  try {
    window.sessionStorage.setItem(SIGNED_OUT_KEY, "1");
  } catch {
    // The page still starts over; it just does not say why.
  }
  window.location.assign("/single");
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

/**
 * Coming back from Google, or from signing out: say how it went and take
 * the marker off the address. `url` is the address the page opened with.
 */
function handleAccountReturn(url) {
  let signedOut = false;
  try {
    signedOut = window.sessionStorage.getItem(SIGNED_OUT_KEY) === "1";
    window.sessionStorage.removeItem(SIGNED_OUT_KEY);
  } catch {
    // Nothing to report.
  }
  if (signedOut) setMessage("已退出登录。这个浏览器不再保留你的账号和房间身份。");
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
      setMessage(`已用 Google 登录：${account.name}。`);
      accountHooks.changed();
    } else {
      setMessage("Google 登录没有完成，请再试一次。", true);
    }
  });
}

/** Wire the button, the dialog and the guest note; hooks come from main.js. */
function wireAccount(hooks = {}) {
  accountHooks = { ...accountHooks, ...hooks };
  renderAccountButton();
  renderGuestNote();
  elements.accountButton.addEventListener("click", () => openAccountDialog("sign-in"));
  elements.recordsRegister.addEventListener("click", () => openAccountDialog("register"));
  for (const button of elements.accountTabButtons) {
    button.addEventListener("click", () => {
      accountTab = button.dataset.accountTab === "register" ? "register" : "sign-in";
      showAccountError();
      renderAccountDialog();
    });
  }
  elements.accountForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitAccountForm();
  });
  elements.accountCancel.addEventListener("click", closeAccountDialog);
  elements.accountDone.addEventListener("click", closeAccountDialog);
  elements.accountSignOut.addEventListener("click", () => void signOut());
  elements.accountGoogleButton.addEventListener("click", () => void startGoogleSignIn());
  elements.accountDialog.addEventListener("close", () => showAccountError());
}

export {
  accountSeen,
  handleAccountReturn,
  wireAccount,
};
