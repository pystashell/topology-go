/**
 * The account behind this browser: the top bar button and its dialog to
 * sign in (password, a code sent by email, or Google), register, sign out,
 * add or confirm an email and set a new password; and the guest note on My
 * games. A guest who registers or signs in keeps its games (worker/auth.js
 * adoptGuest). Someone who forgot their password signs in with an email
 * code and sets a new one right away (worker/accounts.js). The session
 * lives in an HttpOnly cookie scripts cannot read; this page only
 * remembers the account's name, to show it before asking the server.
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
const SEND_CODE_LABEL = "发送验证码";
const CODE_PATTERN = /^\d{6}$/u;

// What the server last said: { guest, name, email, emailVerified,
// hasPassword, freshUntil }, or null for nobody.
let account = null;
let signInOptions = { passwords: true, google: false, emailCodes: false };
// "sign-in", "register" or "code" (signing in with an email code).
let accountTab = "sign-in";
let accountBusy = false;
let accountHooks = { beforeSignOut: async () => {}, changed: () => {} };
// The send-code button waiting before another code may be asked for.
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
      freshUntil: summary.freshUntil ?? known.freshUntil ?? 0,
    };
  }
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
    if (payload?.signIn) {
      signInOptions = {
        passwords: payload.signIn.passwords !== false,
        google: payload.signIn.google === true,
        emailCodes: payload.signIn.emailCodes === true,
      };
    }
    accountSeen(payload?.account ?? null);
    return true;
  } catch {
    return false;
  }
}

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
  for (const control of elements.accountForm.querySelectorAll("button, input")) {
    control.disabled = busy || control.dataset.waiting === "1";
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

/** Whether a new password needs the current one (not just after signing in). */
function needsCurrentPassword() {
  return Boolean(account?.hasPassword) && Date.now() > (account?.freshUntil ?? 0);
}

function renderSignedIn() {
  elements.accountName.textContent = account.name ?? "";
  elements.accountEmail.textContent = !account.email
    ? "没有填邮箱。"
    : account.emailVerified ? `邮箱：${account.email}（已验证）` : `邮箱：${account.email}（未验证）`;
  elements.accountPasswordState.hidden = account.hasPassword;
  elements.accountEmailEdit.hidden = !signInOptions.emailCodes;
  elements.accountEmailEdit.textContent = !account.email
    ? "添加邮箱"
    : account.emailVerified ? "更换邮箱" : "验证邮箱";
  elements.accountPasswordEdit.textContent = account.hasPassword ? "设置新密码" : "设置密码";
  const needCurrent = needsCurrentPassword();
  elements.accountCurrentPasswordField.hidden = !needCurrent;
  elements.accountPasswordNote.textContent = !account.hasPassword
    ? "设好以后也可以用用户名和密码登录。改好后，其他设备上的登录会退出。"
    : needCurrent
      ? "需要当前密码。忘了的话，先退出，再用邮箱验证码登录：登录后 10 分钟内可以直接设新密码。"
      : "你刚登录，可以直接设新密码。改好后，其他设备上的登录会退出。";
}

function renderAccountDialog() {
  const signedIn = Boolean(account && !account.guest);
  elements.accountSignedIn.hidden = !signedIn;
  elements.accountForms.hidden = signedIn;
  elements.accountCancelRow.hidden = signedIn;
  elements.accountTitle.textContent = signedIn ? "你的账号" : "登录或注册";
  if (signedIn) {
    renderSignedIn();
    return;
  }
  const tab = accountTab === "code" ? "sign-in" : accountTab;
  for (const button of elements.accountTabButtons) {
    const active = button.dataset.accountTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  for (const panel of elements.accountPanels) panel.hidden = panel.dataset.accountPanel !== accountTab;
  elements.accountGuestNote.hidden = account?.guest !== true;
  elements.accountGoogle.hidden = !signInOptions.google;
  elements.accountUseCode.hidden = !signInOptions.emailCodes;
  elements.accountRegisterNote.textContent = signInOptions.emailCodes
    ? "建议填邮箱：忘了密码时可以用它收验证码登录，登录后再设新密码。"
    : "暂时还不能找回密码，请记好它。";
}

function showTab(tab) {
  accountTab = ["register", "code"].includes(tab) ? tab : "sign-in";
  showAccountError();
  showAccountInfo();
  renderAccountDialog();
}

function openAccountDialog(tab = "sign-in") {
  showTab(tab);
  closeSubforms();
  if (!elements.accountDialog.open) elements.accountDialog.showModal();
  (accountTab === "register" ? elements.registerUsername : elements.signInLogin).focus();
  void refreshAccount().then(() => {
    if (elements.accountDialog.open) renderAccountDialog();
  });
}

function closeSubforms() {
  elements.accountEmailForm.hidden = true;
  elements.accountPasswordForm.hidden = true;
}

/** Show one of the signed-in forms (email or password), or hide it again. */
function toggleSubform(form) {
  const opening = form.hidden;
  closeSubforms();
  showAccountError();
  showAccountInfo();
  form.hidden = !opening;
  if (!opening) return;
  if (form === elements.accountEmailForm) {
    elements.accountEmailInput.value = account?.email && !account.emailVerified ? account.email : "";
    elements.accountEmailCode.value = "";
    elements.accountEmailInput.focus();
  } else {
    renderSignedIn();
    (needsCurrentPassword() ? elements.accountCurrentPassword : elements.accountNewPassword).focus();
  }
}

function clearSecrets() {
  for (const input of [
    elements.signInPassword, elements.registerPassword, elements.registerPasswordAgain,
    elements.codeInput, elements.accountEmailCode, elements.accountCurrentPassword,
    elements.accountNewPassword, elements.accountNewPasswordAgain,
  ]) {
    input.value = "";
  }
}

function closeAccountDialog() {
  if (elements.accountDialog.open) elements.accountDialog.close();
  clearSecrets();
  closeSubforms();
  showAccountError();
  showAccountInfo();
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
    showAccountError("请填写账号的邮箱。");
    elements.codeEmail.focus();
    return;
  }
  await requestCode("/api/account/email-code", email, elements.codeSend);
  // The same answer whether or not the address has an account.
  showAccountInfo(`如果 ${email} 是这个网站上某个账号的邮箱，验证码已经发过去了，10 分钟内有效。`);
  elements.codeInput.focus();
}

/**
 * Signed in with a code: the dialog stays open on the new password form,
 * since that is usually why (a forgotten password).
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
  clearSecrets();
  accountSeen(payload.account);
  useAccountName(payload.account);
  await refreshAccount();
  accountHooks.changed();
  setMessage(`已登录：${payload.account?.name ?? email}。`);
  toggleSubform(elements.accountPasswordForm);
  showAccountInfo("已登录。忘了密码的话，现在就可以直接设一个新密码。");
}

async function sendEmailCode() {
  const email = cleanEmail(elements.accountEmailInput.value);
  if (!email) {
    showAccountError("请填写邮箱。");
    elements.accountEmailInput.focus();
    return;
  }
  await requestCode("/api/account/email", email, elements.accountEmailSend);
  showAccountInfo(`验证码已发到 ${email}，10 分钟内有效。`);
  elements.accountEmailCode.focus();
}

async function confirmEmail() {
  const email = cleanEmail(elements.accountEmailInput.value);
  const code = elements.accountEmailCode.value.trim();
  if (!email || !CODE_PATTERN.test(code)) {
    showAccountError("请填写邮箱和收到的 6 位数验证码。");
    (email ? elements.accountEmailCode : elements.accountEmailInput).focus();
    return;
  }
  const payload = await postAccount("/api/account/email/confirm", { email, code });
  elements.accountEmailCode.value = "";
  accountSeen(payload.account);
  closeSubforms();
  showAccountInfo("邮箱已验证。");
}

async function saveNewPassword() {
  const password = elements.accountNewPassword.value;
  if (!passwordAllowed(password)) {
    showAccountError("密码要 8 到 128 个字符。");
    elements.accountNewPassword.focus();
    return;
  }
  if (password !== elements.accountNewPasswordAgain.value) {
    showAccountError("两次输入的密码不一样。");
    elements.accountNewPasswordAgain.focus();
    return;
  }
  const body = { password };
  if (needsCurrentPassword()) body.currentPassword = elements.accountCurrentPassword.value;
  const payload = await postAccount("/api/account/password", body);
  clearSecrets();
  accountSeen(payload.account);
  closeSubforms();
  showAccountInfo("新密码已保存，其他设备上的登录已经退出。");
}

/** Run one of the dialog's actions: busy meanwhile, its error shown. */
async function runAction(action, fallback = "暂时无法登录，请稍后再试。") {
  if (accountBusy) return;
  showAccountError();
  setAccountBusy(true);
  try {
    await action();
  } catch (error) {
    showAccountError(localizedErrorMessage(error, fallback));
  } finally {
    setAccountBusy(false);
  }
}

/** Enter in the dialog: the action of the part being filled in. */
function submitAccountForm() {
  const area = document.activeElement?.closest?.("[data-account-enter]")?.dataset.accountEnter;
  const onCode = [elements.codeInput, elements.accountEmailCode].includes(document.activeElement);
  if (area === "code") return runAction(onCode || elements.codeInput.value ? signInWithCode : sendSignInCode);
  if (area === "email") return runAction(onCode ? confirmEmail : sendEmailCode, "暂时无法验证邮箱，请稍后再试。");
  if (area === "password") return runAction(saveNewPassword, "暂时无法保存密码，请稍后再试。");
  return runAction(accountTab === "register" ? register : signIn);
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
    button.addEventListener("click", () => showTab(button.dataset.accountTab));
  }
  for (const button of elements.accountGoButtons) {
    button.addEventListener("click", () => showTab(button.dataset.accountGo));
  }
  elements.accountUseCode.addEventListener("click", () => {
    const login = elements.signInLogin.value.trim();
    if (login.includes("@") && !elements.codeEmail.value) elements.codeEmail.value = login;
    showTab("code");
    elements.codeEmail.focus();
  });
  elements.accountForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitAccountForm();
  });
  elements.codeSend.addEventListener("click", () => void runAction(sendSignInCode));
  elements.codeSignIn.addEventListener("click", () => void runAction(signInWithCode));
  elements.accountEmailEdit.addEventListener("click", () => toggleSubform(elements.accountEmailForm));
  elements.accountPasswordEdit.addEventListener("click", () => toggleSubform(elements.accountPasswordForm));
  elements.accountEmailSend.addEventListener("click", () =>
    void runAction(sendEmailCode, "暂时无法验证邮箱，请稍后再试。"));
  elements.accountEmailConfirm.addEventListener("click", () =>
    void runAction(confirmEmail, "暂时无法验证邮箱，请稍后再试。"));
  elements.accountPasswordSave.addEventListener("click", () =>
    void runAction(saveNewPassword, "暂时无法保存密码，请稍后再试。"));
  elements.accountCancel.addEventListener("click", closeAccountDialog);
  elements.accountDone.addEventListener("click", closeAccountDialog);
  elements.accountSignOut.addEventListener("click", () => void signOut());
  elements.accountGoogleButton.addEventListener("click", () => void startGoogleSignIn());
  elements.accountDialog.addEventListener("close", () => {
    showAccountError();
    showAccountInfo();
  });
}

export {
  accountSeen,
  handleAccountReturn,
  wireAccount,
};
