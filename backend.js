// Cross-device accounts and realtime room sync. This runs after the UI's inline script.
let vantaDb = null;
let vantaSession = null;
let vantaRole = "member";
let roomRealtime = null;
let presenceRealtime = null;
let settingsRealtime = null;
let typingTimer = null;
let workspaceSettings = {
  name: localStorage.getItem("vanta-space-name") || "General Queue",
  description: localStorage.getItem("vanta-space-description") || "A waiting room, but for messages."
};
if (["General Queue", "General Queue"].includes(workspaceSettings.name)) { workspaceSettings.name = "General Queue"; localStorage.setItem("vanta-space-name", workspaceSettings.name); }

const backendConfig = window.VANTA_CONFIG || {};
const publicSupabaseKey = backendConfig.supabasePublishableKey || backendConfig.supabaseAnonKey;
if (window.supabase?.createClient && backendConfig.supabaseUrl && publicSupabaseKey && !backendConfig.supabaseUrl.includes("YOUR_PROJECT_ID")) {
  vantaDb = window.supabase.createClient(backendConfig.supabaseUrl, publicSupabaseKey);
}

function safeAttachmentUrl(value) {
  return typeof value === "string" && /^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(value) ? value : "#";
}

function accountUI() {
  const signedIn = Boolean(vantaSession);
  const status = document.querySelector("#miniStatus");
  const liveCount = document.querySelector("#liveCount");
  const syncState = document.querySelector("#syncState"), syncDetail = document.querySelector("#syncDetail"), syncDot = document.querySelector("#syncDot"), syncAction = document.querySelector("#syncAction");
  const modShortcut = document.querySelector("#modShortcut");
  const composer = document.querySelector("#messageInput");
  if (composer) { composer.disabled = !signedIn; composer.placeholder = signedIn ? `Leave a thought in #${current}…` : "Sign in to join the conversation"; }
  if (status) status.textContent = signedIn ? (vantaRole === "moderator" ? "Moderator · online" : "Account synced · online") : "Not signed in";
  if (syncState) syncState.textContent = signedIn ? `Signed in as ${profile.name}` : "Not signed in";
  if (syncDetail) syncDetail.textContent = signedIn ? "Your account is synced" : vantaDb ? "This device until you sign in" : "Local preview";
  if (syncDot) syncDot.classList.toggle("connected", signedIn);
  if (syncAction) syncAction.textContent = signedIn ? "Profile" : "Sign in";
  if (modShortcut) modShortcut.hidden = !signedIn || vantaRole !== "moderator";
  if (liveCount && !signedIn) liveCount.textContent = "Sign in to see members";
  const memberList = document.querySelector("#memberList");
  if (memberList && vantaDb && !signedIn) memberList.innerHTML = '<div style="font-size:10px;color:var(--muted);padding:8px 4px">Sign in to see who is around.</div>';
}

function openAccount() {
  if (!vantaDb) {
    showDialog("Set up cross-device accounts", `<p>The General Chat Department is currently a local preview. To let people create profiles and share room messages across computers, connect a free Supabase project.</p><ol><li>Create a Supabase project.</li><li>Run <b>supabase-schema.sql</b> in its SQL Editor.</li><li>Copy <b>config.example.js</b> to <b>config.js</b> and add the project URL and publishable key.</li><li>Publish the site again, then create an account here.</li></ol><p>Never put a service-role key in a website.</p><a href="https://supabase.com/dashboard" target="_blank" rel="noopener" class="dialog-btn primary">Open Supabase ↗</a>`);
    return;
  }
  if (vantaSession) {
    showDialog("Your Department account", `<p>Signed in as <b>${esc(vantaSession.user.email)}</b>. Your profile and room messages sync to this account.</p><button class="dialog-btn" onclick="openProfile()">Edit your profile</button><div class="dialog-actions"><button class="dialog-btn" onclick="closeDialog()">Close</button><button class="dialog-btn primary" onclick="signOutNocturne()">Sign out</button></div>`);
    return;
  }
  showDialog("Join the conversation", `<p>Create one account and use it to keep your profile and room messages with you on any computer.</p><label class="field">DISPLAY NAME</label><input class="field-input" id="authName" maxlength="28" autocomplete="nickname" placeholder="How people will know you"><label class="field">EMAIL</label><input class="field-input" id="authEmail" type="email" autocomplete="email" placeholder="you@example.com"><label class="field">PASSWORD</label><input class="field-input" id="authPassword" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters"><div id="authError" style="font-size:10px;color:var(--danger);margin-top:8px"></div><div class="dialog-actions"><button class="dialog-btn" onclick="authenticateNocturne('login')">Sign in</button><button class="dialog-btn primary" onclick="authenticateNocturne('signup')">Create account</button></div><p style="margin-bottom:0">You may need to confirm your email before signing in.</p>`);
}

async function authenticateNocturne(mode) {
  const email = document.querySelector("#authEmail").value.trim();
  const password = document.querySelector("#authPassword").value;
  const name = document.querySelector("#authName").value.trim();
  const error = document.querySelector("#authError");
  if (!email || !password || (mode === "signup" && !name)) { error.textContent = mode === "signup" ? "Choose a display name, email, and password." : "Enter your email and password."; return; }
  if (mode === "signup" && password.length < 8) { error.textContent = "Use a password with at least 8 characters."; return; }
  error.textContent = "";
  const result = mode === "signup"
    ? await vantaDb.auth.signUp({ email, password, options: { data: { display_name: name } } })
    : await vantaDb.auth.signInWithPassword({ email, password });
  if (result.error) { error.textContent = result.error.message; return; }
  if (result.data.session) {
    await applyNocturneSession(result.data.session);
    closeDialog();
    toast(mode === "signup" ? "Your Department account is ready" : "Welcome back");
  } else {
    showDialog("Check your email", `<p>Supabase sent a verification link to <b>${esc(email)}</b>. Confirm your address, then come back here to sign in.</p><button class="dialog-btn primary" onclick="closeDialog()">Okay</button>`);
  }
}

async function signOutNocturne() {
  const result = await vantaDb.auth.signOut();
  if (result.error) { toast(result.error.message); return; }
  vantaSession = null;
  vantaRole = "member";
  if (roomRealtime) await vantaDb.removeChannel(roomRealtime);
  if (presenceRealtime) await vantaDb.removeChannel(presenceRealtime);
  if (settingsRealtime) await vantaDb.removeChannel(settingsRealtime);
  roomRealtime = presenceRealtime = settingsRealtime = null;
  data = { ...seed };
  accountUI(); closeDialog(); render(); toast("Signed out");
}

async function applyNocturneSessionBase(session) {
  if (!vantaDb || !session) return;
  vantaSession = session;
  const result = await vantaDb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  if (result.error) { toast("Could not load profile: " + result.error.message); return; }
  let row = result.data;
  if (!row) {
    const displayName = session.user.user_metadata?.display_name?.trim();
    if (!displayName) { await vantaDb.auth.signOut(); vantaSession = null; toast("Choose a display name when creating your account."); accountUI(); return; }
    const candidate = { id: session.user.id, display_name: displayName, status: "", about: "", theme: "paperwork" };
    const created = await vantaDb.from("profiles").upsert(candidate).select().single();
    if (created.error) { toast("Profile setup failed: " + created.error.message); return; }
    row = created.data;
  }
  if (row.account_disabled) { await vantaDb.auth.signOut(); vantaSession = null; vantaRole = "member"; accountUI(); showDialog("Account unavailable", "A moderator has disabled this account on this site. Contact a moderator if you think this was a mistake."); return; }
  profile = { name: row.display_name, status: row.status, about: row.about };
  vantaRole = row.role || "member";
  document.querySelector("#miniName").textContent = profile.name;
  document.querySelector("#miniAvatar").firstChild.textContent = initials(profile.name);
  document.querySelector("#miniInitial").textContent = initials(profile.name);
  if (row.theme && themes.some(theme => theme[0] === row.theme)) document.documentElement.dataset.theme = row.theme;
  await loadWorkspaceSettings();
  accountUI();
  await startNocturnePresence();
  await startWorkspaceRealtime();
  subscribeNocturneRoom();
}

async function loadNocturneRoom() {
  if (!vantaDb || !vantaSession) return;
  const result = await vantaDb.from("messages").select("id,channel,user_id,content,files,reply_to,created_at,profiles(display_name,role)").eq("channel", current).order("created_at", { ascending: true }).limit(150);
  if (result.error) { toast("Could not load shared room: " + result.error.message); return; }
  const rows = result.data || [];
  const ids = rows.map(message => message.id);
  let reactions = [];
  if (ids.length) {
    const response = await vantaDb.from("message_reactions").select("message_id,emoji,user_id").in("message_id", ids);
    if (response.error) { toast("Could not load reactions: " + response.error.message); return; }
    reactions = response.data || [];
  }
  const counts = {};
  for (const reaction of reactions) {
    counts[reaction.message_id] ??= {};
    counts[reaction.message_id][reaction.emoji] ??= 0;
    counts[reaction.message_id][reaction.emoji]++;
  }
  data[current] = rows.map(message => {
    const name = message.profiles?.display_name || "Member";
    return { id: message.id, user: name, role: message.profiles?.role || "member", initial: initials(name), color: colorFor(name), time: new Date(message.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), text: message.content, files: message.files || [], replyTo: message.reply_to, reactions: Object.entries(counts[message.id] || {}).map(([emoji, count]) => emoji + " " + count), remote: true };
  });
  render();
}

function subscribeNocturneRoom() {
  if (!vantaDb || !vantaSession) return;
  if (roomRealtime) vantaDb.removeChannel(roomRealtime);
  roomRealtime = vantaDb.channel("vanta-room-" + current)
    .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `channel=eq.${current}` }, loadNocturneRoom)
    .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, loadNocturneRoom)
    .subscribe();
  loadNocturneRoom();
}

async function startNocturnePresence() {
  if (!vantaDb || !vantaSession) return;
  if (presenceRealtime) await vantaDb.removeChannel(presenceRealtime);
  presenceRealtime = vantaDb.channel("vanta-presence", { config: { presence: { key: vantaSession.user.id } } })
    .on("presence", { event: "sync" }, renderNocturneMembers)
    .subscribe(status => { if (status === "SUBSCRIBED") presenceRealtime.track({ id: vantaSession.user.id, name: profile.name, channel: current, role: vantaRole }); });
}

function renderNocturneMembers() {
  if (!presenceRealtime) return;
  const members = Object.values(presenceRealtime.presenceState()).flat();
  document.querySelector("#liveCount").textContent = members.length + " online";
  document.querySelector("#memberList").innerHTML = members.map(member => {
    const name = member.name || "Member";
    return `<button class="member-row" data-name="${esc(name)}" onclick="openMemberProfile('${esc(member.id || "")}')"><div class="avatar" style="background:${esc(colorFor(name))}">${esc(initials(name))}</div><span><strong>${esc(name)}</strong><small>in #${esc(channelLabel(member.channel || "lobby"))}</small></span>${member.role === "moderator" ? '<span class="role">MOD</span>' : ''}<span class="member-badge">●</span></button>`;
  }).join("") || '<div style="font-size:10px;color:var(--muted);padding:8px 4px">No one is online right now.</div>';
  const typing = members.filter(member => member.id !== vantaSession?.user.id && member.channel === current && member.typing);
  const indicator = document.querySelector("#typingIndicator");
  if (indicator) indicator.textContent = typing.length ? `${typing.slice(0,2).map(member=>member.name).join(" and ")}${typing.length > 2 ? " and others" : ""} typing a message…` : "";
}

function selectChannel(element) {
  current = element.dataset.channel;
  document.querySelectorAll(".nav-item[data-channel]").forEach(item => item.classList.toggle("active", item === element));
  const label = channelLabel(current);
  document.querySelector("#channelTitle").textContent = label;
  document.querySelector("#welcomeTitle").textContent = current === "lobby" ? "Welcome to the lobby." : `A fresh page in ${label}.`;
  document.querySelector("#welcomeDesc").textContent = current === "lobby" ? "A good place to begin, pick up a thought, or just say hi." : `Pull up a chair. This is your corner for ${label}.`;
  document.querySelector("#messageInput").placeholder = vantaSession ? `Leave a thought in #${current}…` : "Sign in to join the conversation";
  document.querySelector("#topicIcon").textContent = current === "lobby" ? "◌" : "✳";
  document.querySelector("#introMark").textContent = current === "lobby" ? "◌" : "✳";
  document.querySelector("#channelDesc").textContent = current === "lobby" ? "Casual conversation, unexpected recommendations, and good energy." : `A calm corner to share ideas about ${label}.`;
  render(); toggleSide(false); document.querySelector("#searchInput").value = ""; searchMessages("");
  if (vantaSession) { if (presenceRealtime) presenceRealtime.track({ id: vantaSession.user.id, name: profile.name, channel: current, role: vantaRole }); subscribeNocturneRoom(); }
}

async function sendMessage() {
  const box = document.querySelector("#messageInput"), text = box.value.trim();
  if (!text && !attachments.length) return;
  if (!vantaSession) { openProfile(); toast("Create an account or sign in before chatting."); return; }
  if (text.length > 2000) { toast("Messages can be up to 2,000 characters"); return; }
  if (vantaDb && vantaSession) {
    const state = await vantaDb.from("member_moderation").select("muted_until,last_reason").eq("user_id", vantaSession.user.id).maybeSingle();
    if (state.data?.muted_until && Date.parse(state.data.muted_until) > Date.now()) { toast(`Messaging is paused until ${new Date(state.data.muted_until).toLocaleTimeString()}. ${state.data.last_reason || ""}`); return; }
    const result = await vantaDb.from("messages").insert({ channel: current, user_id: vantaSession.user.id, content: text, files: attachments.map(file => ({ name: file.name, type: file.type, data: file.data || null })), reply_to: replyTo });
    if (result.error) { toast("Message not sent: " + result.error.message); return; }
    box.value = ""; box.style.height = "auto"; document.querySelector("#draftCount").textContent = "0 / 2000"; attachments = []; cancelReply(); await loadNocturneRoom(); box.focus(); return;
  }
  toast("Chat service is not connected yet. Set up the Supabase account first."); openProfile();
}

async function react(index, reactionIndex) {
  if (vantaDb && vantaSession) {
    const message = data[current][index], emoji = message.reactions[reactionIndex].replace(/\s+\d+$/, "");
    const existing = await vantaDb.from("message_reactions").select("id").eq("message_id", message.id).eq("user_id", vantaSession.user.id).eq("emoji", emoji).maybeSingle();
    if (existing.error) { toast(existing.error.message); return; }
    const result = existing.data ? await vantaDb.from("message_reactions").delete().eq("id", existing.data.id) : await vantaDb.from("message_reactions").insert({ message_id: message.id, user_id: vantaSession.user.id, emoji });
    if (result.error) { toast("Reaction failed: " + result.error.message); return; }
    await loadNocturneRoom(); return;
  }
  const parts = data[current][index].reactions[reactionIndex].split(" "), count = +(parts.at(-1) || 1);
  data[current][index].reactions[reactionIndex] = parts.slice(0, -1).join(" ") + " " + (count + 1); save(); render();
}

async function addReactionEmoji(index, emoji) {
  if (vantaDb && vantaSession) {
    const result = await vantaDb.from("message_reactions").insert({ message_id: data[current][index].id, user_id: vantaSession.user.id, emoji });
    if (result.error && result.error.code !== "23505") { toast("Reaction failed: " + result.error.message); return; }
    await loadNocturneRoom(); closeDialog(); return;
  }
  data[current][index].reactions ??= []; data[current][index].reactions.push(emoji + " 1"); save(); closeDialog(); render();
}

function openProfile() {
  showDialog("Your profile", `<p>${vantaSession ? "Your profile follows your account across computers." : "This preview profile is stored on this device. Sign in to sync it across computers."}</p><label class="field">DISPLAY NAME</label><input class="field-input" id="profileName" maxlength="28" value="${esc(profile.name)}"><label class="field">STATUS LINE</label><input class="field-input" id="profileStatus" maxlength="48" value="${esc(profile.status)}"><label class="field">A LITTLE ABOUT YOU</label><textarea class="field-input" id="profileAbout" rows="3" maxlength="160">${esc(profile.about)}</textarea><div class="dialog-actions"><button class="dialog-btn" onclick="closeDialog()">Cancel</button><button class="dialog-btn primary" onclick="saveProfile()">Save profile</button></div>`);
}

async function saveProfile() {
  profile.name = document.querySelector("#profileName").value.trim() || "";
  profile.status = document.querySelector("#profileStatus").value.trim() || "Around";
  profile.about = document.querySelector("#profileAbout").value.trim();
  localStorage.setItem("vanta-name", profile.name); localStorage.setItem("vanta-status", profile.status); localStorage.setItem("vanta-about", profile.about);
  document.querySelector("#miniName").textContent = profile.name; document.querySelector("#miniAvatar").firstChild.textContent = initials(profile.name); document.querySelector("#miniInitial").textContent = initials(profile.name);
  if (vantaDb && vantaSession) {
    const result = await vantaDb.from("profiles").update({ display_name: profile.name, status: profile.status, about: profile.about, theme: document.documentElement.dataset.theme, updated_at: new Date().toISOString() }).eq("id", vantaSession.user.id);
    if (result.error) { toast("Profile did not sync: " + result.error.message); return; }
    if (presenceRealtime) presenceRealtime.track({ name: profile.name, channel: current, role: vantaRole });
  }
  closeDialog(); toast("Profile saved" + (vantaSession ? " and synced" : " on this device"));
}

function setTheme(id) {
  document.documentElement.dataset.theme = id; localStorage.setItem("vanta-theme", id);
  if (vantaDb && vantaSession) vantaDb.from("profiles").update({ theme: id, updated_at: new Date().toISOString() }).eq("id", vantaSession.user.id).then(({ error }) => { if (error) toast("Theme saved here; account sync failed: " + error.message); });
  openThemes(); toast(`${themes.find(theme => theme[0] === id)[1]} theme applied`);
}

async function saveEdit(id) {
  const text = document.querySelector("#editText").value.trim();
  if (vantaDb && vantaSession) {
    const result = await vantaDb.from("messages").update({ content: text, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", vantaSession.user.id);
    if (result.error) { toast("Edit failed: " + result.error.message); return; }
    closeDialog(); await loadNocturneRoom(); return;
  }
  const message = data[current].find(item => item.id === id);
  if (message) { message.text = text; message.edited = true; save(); closeDialog(); render(); }
}

function openCommunity() { openAccount(); }

function handleFiles(files) {
  const selected = [...files];
  let pending = selected.length;
  selected.forEach(file => {
    if (file.size > 600 * 1024) { toast(`${file.name} is over the 600 KB demo limit`); if (--pending === 0) document.querySelector("#fileInput").value = ""; return; }
    const reader = new FileReader();
    reader.onload = () => { attachments.push({ name: file.name, type: file.type || "application/octet-stream", data: reader.result }); if (--pending === 0) { document.querySelector("#fileInput").value = ""; toast(`${attachments.length} attachment${attachments.length === 1 ? "" : "s"} ready to send`); } };
    reader.onerror = () => { if (--pending === 0) document.querySelector("#fileInput").value = ""; toast(`Could not read ${file.name}`); };
    reader.readAsDataURL(file);
  });
}

function updateWorkspaceUI() {
  document.querySelector("#workspaceName").textContent = workspaceSettings.name;
  document.querySelector("#workspaceSummary").textContent = workspaceSettings.description || "one community · open to everyone";
}

async function loadWorkspaceSettings() {
  if (!vantaDb || !vantaSession) { updateWorkspaceUI(); return; }
  const result = await vantaDb.from("workspace_settings").select("name,description").eq("id", "main").maybeSingle();
  if (result.error) { toast("Workspace settings need the moderator database update."); updateWorkspaceUI(); return; }
  if (result.data) {
    workspaceSettings = { name: result.data.name, description: result.data.description || "" };
    localStorage.setItem("vanta-space-name", workspaceSettings.name);
    localStorage.setItem("vanta-space-description", workspaceSettings.description);
  }
  updateWorkspaceUI();
}

async function openWorkspace() {
  if (vantaDb && vantaSession) await loadWorkspaceSettings();
  const canEdit = !vantaDb || (vantaSession && vantaRole === "moderator");
  const editor = canEdit
    ? `<label class="field">SERVER NAME</label><input class="field-input" id="workspaceNameInput" maxlength="40" value="${esc(workspaceSettings.name)}"><label class="field">ABOUT THIS SERVER</label><textarea class="field-input" id="workspaceDescriptionInput" maxlength="120" rows="3">${esc(workspaceSettings.description)}</textarea><div class="dialog-actions"><button class="dialog-btn" onclick="copyInvite()">Copy invite link</button><button class="dialog-btn primary" onclick="saveWorkspaceSettings()">Save server</button></div>`
    : `<p>${esc(workspaceSettings.description)}</p><p>${vantaSession ? "Only a moderator can edit this server." : "Sign in to join the conversation."}</p><div class="dialog-actions"><button class="dialog-btn" onclick="copyInvite()">Copy invite link</button>${vantaSession ? "" : '<button class="dialog-btn primary" onclick="closeDialog();openAccount()">Sign in</button>'}</div>`;
  showDialog(workspaceSettings.name, `<p>One shared server. Unlimited filing opportunities.</p>${editor}`);
}

async function saveWorkspaceSettings() {
  const name = document.querySelector("#workspaceNameInput").value.trim();
  const description = document.querySelector("#workspaceDescriptionInput").value.trim();
  if (!name) { toast("Give your server a name first."); return; }
  if (vantaDb && (!vantaSession || vantaRole !== "moderator")) { toast("Only moderators can edit the shared server."); return; }
  if (vantaDb) {
    const result = await vantaDb.from("workspace_settings").update({ name, description, updated_at: new Date().toISOString() }).eq("id", "main").select().single();
    if (result.error) { toast("Server settings did not save: " + result.error.message); return; }
  }
  workspaceSettings = { name, description };
  localStorage.setItem("vanta-space-name", name); localStorage.setItem("vanta-space-description", description);
  updateWorkspaceUI(); closeDialog(); toast("Server settings saved");
}

async function startWorkspaceRealtime() {
  if (!vantaDb || !vantaSession) return;
  if (settingsRealtime) await vantaDb.removeChannel(settingsRealtime);
  settingsRealtime = vantaDb.channel("vanta-workspace-settings")
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "workspace_settings", filter: "id=eq.main" }, loadWorkspaceSettings)
    .subscribe();
}

function newChannel() {
  showDialog("Create a room", `<p>Add a room inside your one community server.</p><label class="field">ROOM NAME</label><input class="field-input" id="newRoomName" maxlength="32" placeholder="e.g. book-club"><div class="dialog-actions"><button class="dialog-btn" onclick="closeDialog()">Cancel</button><button class="dialog-btn primary" onclick="createRoomFromDialog()">Create room</button></div>`);
  document.querySelector("#newRoomName").focus();
}

function createRoomFromDialog() {
  let name = document.querySelector("#newRoomName").value.toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  if (!name) { toast("Enter a room name."); return; }
  if (document.querySelector(`[data-channel="${name}"]`)) { toast("That room already exists."); return; }
  const nav = document.createElement("div"); nav.className = "nav-item"; nav.dataset.channel = name;
  nav.innerHTML = `<span class="nav-icon">✳</span><span class="nav-label">${esc(name)}</span>`;
  nav.onclick = () => selectChannel(nav);
  document.querySelector(".side-scroll").insertBefore(nav, document.querySelectorAll(".side-scroll .section-head")[1]);
  data[name] = []; save(); closeDialog(); selectChannel(nav); toast("Room created on this device.");
}

function newDM() {
  showDialog("Start a direct message", `<p>Direct messages are separate from the single community server.</p><label class="field">MEMBER NAME</label><input class="field-input" id="newDmName" maxlength="28" placeholder="Who would you like to message?"><div class="dialog-actions"><button class="dialog-btn" onclick="closeDialog()">Cancel</button><button class="dialog-btn primary" onclick="openNewDM()">Open conversation</button></div>`);
  document.querySelector("#newDmName").focus();
}

function openNewDM() {
  const name = document.querySelector("#newDmName").value.trim();
  if (!name) { toast("Enter a member name."); return; }
  closeDialog(); openDM(name);
}

function addReaction(index) {
  showDialog("Choose a reaction", `<div class="picker">${["✨","💜","🔥","👏","😂","🌿","☁️","👀","💡","🎉","☕","🫶","🪩","🧠","🌙","✅"].map(emoji => `<button onclick="addReactionEmoji(${index},'${emoji}')">${emoji}</button>`).join("")}</div>`);
}

function renderNocturneBase() {
  const list = data[current] || [];
  document.querySelector("#messages").innerHTML = list.length ? list.map((message, index) => {
    const quoted = message.replyTo && list.find(item => item.id === message.replyTo);
    const own = message.user === profile.name;
    const moderator = vantaRole === "moderator";
    return `<article class="message" id="msg-${esc(message.id)}"><div class="avatar" style="background:${esc(message.color)}">${esc(message.initial)}</div><div class="msg-main">${quoted ? `<div class="reply-ref" onclick="scrollToMessage('${esc(quoted.id)}')">↳ ${esc(quoted.user)}: ${esc(quoted.text.slice(0,75))}</div>` : ""}<div class="msg-head"><strong>${esc(message.user)}</strong>${message.role === "moderator" ? '<span class="role">MOD</span>' : ""}<time class="msg-time">${esc(message.time)}</time>${message.edited ? '<span class="msg-time">edited</span>' : ""}</div><div class="msg-content">${esc(message.text).replace(/(https?:\/\/[^\s]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>')}</div>${message.files?.length ? `<div class="attachments">${message.files.map(file => file.type?.startsWith("image/") ? `<a href="${safeAttachmentUrl(file.data)}" target="_blank" rel="noopener"><img src="${safeAttachmentUrl(file.data)}" alt="${esc(file.name)}"></a>` : `<a class="file-chip" href="${safeAttachmentUrl(file.data)}" download="${esc(file.name)}">↓ ${esc(file.name)}</a>`).join("")}</div>` : ""}${message.reactions?.length ? `<div class="reactions">${message.reactions.map((reaction, r) => `<button class="reaction" onclick="react(${index},${r})">${esc(reaction)}</button>`).join("")}<button class="reaction" onclick="addReaction(${index})">＋</button></div>` : ""}</div><div class="msg-actions"><button title="Add reaction" onclick="addReaction(${index})">☺</button><button title="Reply" onclick="reply(${index})">↩</button><button title="Save to pinboard" onclick="togglePin('${esc(message.id)}')">${message.pinned ? "◆" : "◇"}</button>${own ? `<button title="Edit message" onclick="editMessage('${esc(message.id)}')">✎</button>` : ""}${own || moderator ? `<button title="Delete message" onclick="deleteMessage('${esc(message.id)}')">×</button>` : ""}</div></article>`;
  }).join("") : '<div class="empty-state">No notes here yet. Start the conversation with a thought of your own.</div>';
  document.querySelector("#feed").scrollTop = document.querySelector("#feed").scrollHeight;
  updatePins();
}

function deleteMessage(id) {
  showDialog("Delete this message?", `<p>${vantaRole === "moderator" ? "This removes the message for everyone in the room." : "This removes your message from the room."}</p><div class="dialog-actions"><button class="dialog-btn" onclick="closeDialog()">Keep message</button><button class="dialog-btn primary" onclick="confirmDeleteMessage('${esc(id)}')">Delete message</button></div>`);
}

async function confirmDeleteMessage(id) {
  if (vantaDb && vantaSession) {
    let query = vantaDb.from("messages").delete().eq("id", id);
    if (vantaRole !== "moderator") query = query.eq("user_id", vantaSession.user.id);
    const result = await query;
    if (result.error) { toast("Delete failed: " + result.error.message); return; }
    closeDialog(); await loadNocturneRoom(); toast("Message removed"); return;
  }
  data[current] = data[current].filter(message => message.id !== id); pins = pins.filter(pin => pin !== id); save(); closeDialog(); render(); toast("Message deleted");
}

async function copyInvite() {
  const link = location.href;
  try { await navigator.clipboard.writeText(link); toast("Invite link copied"); }
  catch { showDialog("Invite to Nocturne", `<p>Copy this link and share it with your members.</p><input class="field-input" id="inviteLink" readonly value="${esc(link)}"><div class="dialog-actions"><button class="dialog-btn primary" onclick="document.querySelector('#inviteLink').select();toast('Select and copy the link')">Select link</button></div>`); }
}

function hideContextMenu() {
  const menu = document.querySelector("#contextMenu");
  menu.hidden = true; menu.replaceChildren();
}

function showContextMenu(event, heading, items) {
  const menu = document.querySelector("#contextMenu");
  menu.replaceChildren();
  const caption = document.createElement("div"); caption.className = "menu-caption"; caption.textContent = heading; menu.append(caption);
  for (const item of items) {
    if (item.separator) { const line = document.createElement("div"); line.className = "menu-separator"; menu.append(line); continue; }
    const button = document.createElement("button"); button.type = "button"; button.setAttribute("role", "menuitem"); button.textContent = item.label;
    if (item.danger) button.classList.add("danger");
    button.addEventListener("click", () => { hideContextMenu(); item.action(); }); menu.append(button);
  }
  menu.hidden = false;
  const box = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(event.clientX, innerWidth - box.width - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(event.clientY, innerHeight - box.height - 8)) + "px";
  menu.querySelector("button")?.focus();
}

function contextReply(id) { const index = (data[current] || []).findIndex(message => message.id === id); if (index >= 0) reply(index); }
function contextReact(id) { const index = (data[current] || []).findIndex(message => message.id === id); if (index >= 0) addReaction(index); }
function contextEdit(id) { editMessage(id); }
function contextPin(id) { togglePin(id); }

document.addEventListener("contextmenu", event => {
  if (event.target.closest("input,textarea,[contenteditable=true]")) return;
  event.preventDefault();
  const messageElement = event.target.closest(".message");
  const roomElement = event.target.closest(".nav-item[data-channel]");
  const dmElement = event.target.closest(".nav-item.dm,.dm-item[data-id]");
  const memberElement = event.target.closest(".member-row");
  const workspaceElement = event.target.closest(".workspace");
  if (messageElement) {
    const id = messageElement.id.slice(4), message = (data[current] || []).find(item => item.id === id);
    if (!message) return hideContextMenu();
    const own = message.user === profile.name, items = [
      { label: "Reply in room", action: () => contextReply(id) },
      { label: "Add reaction", action: () => contextReact(id) },
      { label: message.pinned ? "Remove from pinboard" : "Save to pinboard", action: () => contextPin(id) }
    ];
    if (own) items.push({ separator: true }, { label: "Edit message", action: () => contextEdit(id) });
    if (own || vantaRole === "moderator") items.push({ label: "Delete message", danger: true, action: () => deleteMessage(id) });
    showContextMenu(event, message.user, items); return;
  }
  if (roomElement) {
    const name = roomElement.dataset.channel;
    showContextMenu(event, "ROOM", [{ label: "Open #" + channelLabel(name), action: () => selectChannel(roomElement) }, { label: "Copy room name", action: () => copyText("#" + name, "Room name copied") }]); return;
  }
  if (dmElement) {
    const name = dmElement.dataset.name || dmElement.querySelector(".nav-label")?.textContent || "Member";
    const id = dmElement.dataset.id;
    showContextMenu(event, "DIRECT MESSAGE", [{ label: "Open conversation with " + name, action: () => id ? openDM(id) : newDM() }]); return;
  }
  if (memberElement) {
    const name = memberElement.dataset.name || memberElement.querySelector("strong")?.textContent || "Member";
    const member = peopleDirectory.find(person => person.display_name === name);
    if (member) showContextMenu(event, "MEMBER", [{ label: "Message " + name, action: () => openDM(member.id) }, { label: "View profile", action: () => openMemberProfile(member.id) }, ...(vantaRole === "moderator" ? [{ label: "Moderator tools", action: () => openMemberProfile(member.id) }] : [])]);
    else showContextMenu(event, "MEMBER", [{ label: "Find member", action: newDM }]);
    return;
  }
  if (workspaceElement) {
    const items = [{ label: "Copy invite link", action: copyInvite }];
    if (!vantaDb || vantaRole === "moderator") items.unshift({ label: "Edit server settings", action: openWorkspace });
    showContextMenu(event, workspaceSettings.name, items); return;
  }
  showContextMenu(event, "DEPARTMENT", [{ label: "Edit server settings", action: openWorkspace }, { label: "Change theme", action: openThemes }, { label: "Edit your profile", action: openProfile }, { label: "Start a direct message", action: newDM }]);
});

async function copyText(value, successMessage) {
  try { await navigator.clipboard.writeText(value); toast(successMessage); }
  catch { showDialog("Copy this text", `<p>Select the text below, then copy it.</p><input class="field-input" id="copyTextValue" readonly value="${esc(value)}"><div class="dialog-actions"><button class="dialog-btn primary" onclick="document.querySelector('#copyTextValue').select()">Select text</button></div>`); }
}

document.addEventListener("pointerdown", event => { if (!event.target.closest("#contextMenu")) hideContextMenu(); });
document.addEventListener("scroll", hideContextMenu, true);
window.addEventListener("resize", hideContextMenu);
document.addEventListener("keydown", event => {
  const menu = document.querySelector("#contextMenu");
  if (event.key === "Escape") hideContextMenu();
  if (menu.hidden) return;
  const buttons = [...menu.querySelectorAll("button")], index = buttons.indexOf(document.activeElement);
  if (event.key === "ArrowDown") { event.preventDefault(); buttons[(index + 1) % buttons.length]?.focus(); }
  if (event.key === "ArrowUp") { event.preventDefault(); buttons[(index - 1 + buttons.length) % buttons.length]?.focus(); }
});

accountUI();
if (vantaDb) {
  vantaDb.auth.onAuthStateChange((_event, session) => {
    if (session) setTimeout(() => applyNocturneSession(session), 0);
    else { vantaSession = null; vantaRole = "member"; if (roomRealtime) vantaDb.removeChannel(roomRealtime); if (presenceRealtime) vantaDb.removeChannel(presenceRealtime); if (settingsRealtime) vantaDb.removeChannel(settingsRealtime); roomRealtime = presenceRealtime = settingsRealtime = null; accountUI(); data = { ...seed }; render(); }
  });
}

// Nocturne account directory, real member-to-member DMs, profile center, and moderation tools.
let peopleDirectory = [];
let currentDM = null;
let currentDMReply = null;
let dmRealtime = null;
let vantaProfile = null;

function openAccount() { openProfile(); }

async function authenticateNocturne(mode) {
  const email = document.querySelector("#profileAuthEmail")?.value.trim() || "";
  const password = document.querySelector("#profileAuthPassword")?.value || "";
  const name = document.querySelector("#profileAuthName")?.value.trim() || "";
  const error = document.querySelector("#profileAuthError");
  if (!email || !password) { if (error) error.textContent = "Add your email and password to continue."; return; }
  if (mode === "signup" && !name) { if (error) error.textContent = "Choose a display name to create your profile."; document.querySelector("#profileAuthName")?.focus(); return; }
  if (mode === "signup" && password.length < 8) { if (error) error.textContent = "Use at least 8 characters for your password."; return; }
  if (error) error.textContent = "";
  const result = mode === "signup"
    ? await vantaDb.auth.signUp({ email, password, options: { data: { display_name: name } } })
    : await vantaDb.auth.signInWithPassword({ email, password });
  if (result.error) { if (error) error.textContent = result.error.message; else toast(result.error.message); return; }
  if (result.data.session) {
    await applyNocturneSession(result.data.session);
    if (!vantaSession) return;
    closeDialog(); toast(mode === "signup" ? "YOUR DEPARTMENT PROFILE is ready" : "Welcome back");
  } else showDialog("Check your email", `<p>We sent a verification link to <b>${esc(email)}</b>. Verify it, then sign in from your profile.</p><button class="dialog-btn primary" onclick="closeDialog();openProfile()">Back to profile</button>`);
}

function openProfile() {
  const accountId = vantaSession?.user?.id || "";
  const role = vantaRole === "moderator" ? '<span class="role">MODERATOR</span>' : '<span class="role member-role">MEMBER</span>';
  const auth = vantaSession
    ? `<div class="profile-account"><div class="profile-card-head"><div><span class="eyebrow">ACCOUNT & SECURITY</span><h3>Signed in</h3></div>${role}</div><p>Your profile, room history, and DMs follow your account across devices.</p><div class="id-card"><span>Department ID</span><code>${esc(accountId)}</code><button class="dialog-btn" onclick="copyText('${esc(accountId)}','Account ID copied')">Copy ID</button></div><button class="dialog-btn" onclick="signOutNocturne()">Sign out</button></div>`
    : vantaDb
      ? `<div class="profile-account"><span class="eyebrow">ACCOUNT & SECURITY</span><h3>Take your profile with you</h3><p>Sign in to find other real members, share conversations, and sync between computers.</p><label class="field">DISPLAY NAME</label><input class="field-input" id="profileAuthName" maxlength="28" autocomplete="nickname" placeholder="Your display name"><label class="field">EMAIL</label><input class="field-input" id="profileAuthEmail" type="email" autocomplete="email" placeholder="you@example.com"><label class="field">PASSWORD</label><input class="field-input" id="profileAuthPassword" type="password" autocomplete="current-password" minlength="8" placeholder="At least 8 characters"><div id="profileAuthError" class="form-error"></div><div class="dialog-actions"><button class="dialog-btn" onclick="authenticateNocturne('login')">Sign in</button><button class="dialog-btn primary" onclick="authenticateNocturne('signup')">Create account</button></div></div>`
      : `<div class="profile-account"><span class="eyebrow">ACCOUNT SETUP</span><h3>Chat requires an account</h3><p>Connect the shared chat service to create an account and talk with other members.</p><a class="dialog-btn" href="https://supabase.com/dashboard" target="_blank" rel="noopener">Open Supabase setup ↗</a></div>`;
  if (!vantaSession) { showDialog("Your profile", auth); return; }
  const cooldown = vantaProfile?.username_changed_at ? Date.parse(vantaProfile.username_changed_at) + 86400000 : 0;
  const locked = vantaSession && cooldown > Date.now();
  const lockNote = locked ? `<p class="cooldown-note">Username changes unlock in ${formatDuration(cooldown - Date.now())}.</p>` : "";
  showDialog("Your profile", `<div class="profile-hero"><div class="profile-avatar">${esc(initials(profile.name))}</div><div><span class="eyebrow">YOUR DEPARTMENT PROFILE</span><h3>${esc(profile.name)}</h3><p>${esc(profile.status)}</p></div></div>${auth}<div class="profile-section"><div class="profile-card-head"><div><span class="eyebrow">PUBLIC PROFILE</span><h3>How members see you</h3></div><button class="dialog-btn" onclick="openThemes()">Themes</button></div><label class="field">USERNAME</label><input class="field-input" id="profileName" maxlength="28" ${locked ? "disabled" : ""} value="${esc(profile.name)}" placeholder="Your display name">${lockNote}<label class="field">STATUS</label><input class="field-input" id="profileStatus" maxlength="48" value="${esc(profile.status)}" placeholder="What are you up to?"><label class="field">ABOUT YOU</label><textarea class="field-input" id="profileAbout" rows="3" maxlength="220" placeholder="A little about yourself">${esc(profile.about)}</textarea><div class="dialog-actions"><button class="dialog-btn" onclick="closeDialog()">Close</button><button class="dialog-btn primary" onclick="saveProfile()">Save profile</button></div></div>`);
}

function formatDuration(milliseconds) {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60000));
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours ? `${hours}h ${rest}m` : `${rest}m`;
}

async function saveProfile() {
  const nameInput = document.querySelector("#profileName");
  const nextName = nameInput?.value.trim() || "";
  const nextStatus = document.querySelector("#profileStatus")?.value.trim() || "";
  const nextAbout = document.querySelector("#profileAbout")?.value.trim() || "";
  if (!nextName) { toast("Choose a display name first."); nameInput?.focus(); return; }
  if (vantaSession && nextName !== profile.name && vantaProfile?.username_changed_at) {
    const unlockAt = Date.parse(vantaProfile.username_changed_at) + 86400000;
    if (unlockAt > Date.now()) { toast(`You can change your username in ${formatDuration(unlockAt - Date.now())}.`); return; }
  }
  if (vantaDb && vantaSession) {
    const update = { display_name: nextName, status: nextStatus, about: nextAbout, theme: document.documentElement.dataset.theme, updated_at: new Date().toISOString() };
    const result = await vantaDb.from("profiles").update(update).eq("id", vantaSession.user.id);
    if (result.error) { toast(result.error.message.includes("24 hours") ? "You can change your username once every 24 hours." : "Profile did not save: " + result.error.message); return; }
    const refreshed = await vantaDb.from("profiles").select("id,display_name,status,about,role,theme,username_changed_at,account_disabled").eq("id", vantaSession.user.id).maybeSingle();
    if (refreshed.error || !refreshed.data || refreshed.data.display_name !== nextName) { toast("Profile did not save. Check the profile update policy in Supabase."); return; }
    vantaProfile = refreshed.data;
    if (presenceRealtime) presenceRealtime.track({ id: vantaSession.user.id, name: nextName, channel: current, role: vantaRole });
    profile = { name: nextName, status: nextStatus, about: nextAbout, id: vantaSession.user.id };
    await loadPeopleDirectory();
  }
  document.querySelector("#miniName").textContent = profile.name;
  document.querySelector("#miniStatus").textContent = profile.status;
  document.querySelector("#miniAvatar").firstElementChild.textContent = initials(profile.name);
  document.querySelector("#miniInitial").textContent = initials(profile.name);
  accountUI(); closeDialog(); render(); toast("Profile saved");
}

async function loadPeopleDirectory() {
  if (!vantaDb || !vantaSession) { peopleDirectory = []; renderPeopleList(); return; }
  const result = await vantaDb.from("profiles").select("id,display_name,status,about,role,username_changed_at,account_disabled").order("display_name", { ascending: true }).limit(1000);
  if (result.error) { toast("Could not load member directory: " + result.error.message); return; }
  peopleDirectory = (result.data || []).filter(person => person.id !== vantaSession.user.id);
  renderPeopleList();
  await loadRecentDMs();
}

function renderPeopleList(query = "") {
  const q = query.trim().toLowerCase();
  const matches = peopleDirectory.filter(person => (vantaRole === "moderator" || !person.account_disabled) && (!q || `${person.display_name} ${person.status || ""}`.toLowerCase().includes(q)));
  const list = document.querySelector("#peopleResults");
  if (list) list.innerHTML = matches.length ? matches.map(person => `<button class="person-result" onclick="openDM('${esc(person.id)}')"><span class="avatar">${esc(initials(person.display_name))}</span><span class="person-copy"><strong>${esc(person.display_name)}</strong><small>${esc(person.status || "Around")}${person.role === "moderator" ? " · Moderator" : ""}</small></span><span class="person-action">Message ↗</span></button>`).join("") : `<div class="empty-directory">${peopleDirectory.length ? "No members match that search." : "No other member accounts exist yet."}</div>`;
  const sidebar = document.querySelector("#dmList");
  if (sidebar && vantaSession && !sidebar.dataset.recent) sidebar.innerHTML = matches.slice(0, 5).map(person => `<button class="dm-item" data-id="${esc(person.id)}" data-name="${esc(person.display_name)}" onclick="openDM('${esc(person.id)}')"><span class="avatar">${esc(initials(person.display_name))}</span><span class="nav-label">${esc(person.display_name)}</span></button>`).join("") || '<div class="dm-empty">No other members yet.</div>';
}

async function loadRecentDMs() {
  if (!vantaDb || !vantaSession) return;
  const id = vantaSession.user.id;
  const result = await vantaDb.from("direct_messages").select("sender_id,recipient_id,content,created_at").or(`sender_id.eq.${id},recipient_id.eq.${id}`).order("created_at", { ascending: false }).limit(100);
  if (result.error) return;
  const recent = [], seen = new Set();
  for (const message of result.data || []) {
    const otherId = message.sender_id === id ? message.recipient_id : message.sender_id;
    if (!seen.has(otherId)) { const person = peopleDirectory.find(item => item.id === otherId && !item.account_disabled); if (person) recent.push({ ...person, preview: message.content }); seen.add(otherId); }
  }
  const sidebar = document.querySelector("#dmList");
  if (!sidebar) return;
  sidebar.dataset.recent = "true";
  sidebar.innerHTML = recent.length ? recent.slice(0,6).map(person => `<button class="dm-item" data-id="${esc(person.id)}" data-name="${esc(person.display_name)}" onclick="openDM('${esc(person.id)}')"><span class="avatar">${esc(initials(person.display_name))}</span><span class="dm-person-copy"><strong>${esc(person.display_name)}</strong><small>${esc(person.preview.slice(0,35))}</small></span></button>`).join("") : '<div class="dm-empty">No conversations yet. A rare moment of inbox zero.</div>';
}

async function newDM() {
  if (!vantaSession) { openProfile(); toast("Sign in to find real member accounts."); return; }
  showDialog("Find a member", `<p>Choose an existing account to start a private conversation. Invented recipients are not on the form.</p><label class="directory-search"><span>⌕</span><input id="peopleSearch" placeholder="Search names or status" autocomplete="off" oninput="renderPeopleList(this.value)"></label><div id="peopleResults" class="people-results"><div class="empty-directory">Loading members…</div></div>`);
  await loadPeopleDirectory();
  document.querySelector("#peopleSearch")?.focus();
  renderPeopleList();
}

async function openDM(userId) {
  if (!vantaSession) { openProfile(); toast("Sign in to message members."); return; }
  let person = peopleDirectory.find(item => item.id === userId);
  if (!person) {
    await loadPeopleDirectory();
    person = peopleDirectory.find(item => item.id === userId);
  }
  if (!person) { toast("Choose someone from the member list first."); return; }
  if (person.account_disabled) { toast("That account is unavailable for messaging."); return; }
  currentDM = person; currentDMReply = null;
  showDialog(`Message ${esc(person.display_name)}`, `<div class="dm-heading"><span class="avatar">${esc(initials(person.display_name))}</span><div><strong>${esc(person.display_name)}</strong><small>${esc(person.status || "Around")} · private conversation</small></div><span class="account-tag">ID ${esc(person.id.slice(0, 8))}</span></div><div id="dmHistory" class="dm-history"><div class="empty-directory">Loading conversation…</div></div><div class="dm-compose"><textarea id="dmMessageInput" rows="2" maxlength="2000" placeholder="Write a private message…"></textarea><button class="dialog-btn primary" onclick="sendDMMessage()">Send ↗</button></div>`);
  await loadDMHistory();
  if (dmRealtime) await vantaDb.removeChannel(dmRealtime);
  dmRealtime = vantaDb.channel("dm-" + vantaSession.user.id + "-" + person.id).on("postgres_changes", { event: "*", schema: "public", table: "direct_messages" }, loadDMHistory).subscribe();
  document.querySelector("#dmMessageInput")?.focus();
}

async function loadDMHistory() {
  if (!currentDM || !vantaSession) return;
  const result = await vantaDb.from("direct_messages").select("id,sender_id,recipient_id,content,reply_to,created_at").or(`and(sender_id.eq.${vantaSession.user.id},recipient_id.eq.${currentDM.id}),and(sender_id.eq.${currentDM.id},recipient_id.eq.${vantaSession.user.id})`).order("created_at", { ascending: true }).limit(200);
  const history = document.querySelector("#dmHistory");
  if (result.error) { if (history) history.innerHTML = '<div class="empty-directory">Private messages need the latest database update.</div>'; return; }
  if (!history) return;
  const byId = new Map((result.data || []).map(message => [message.id, message]));
  history.innerHTML = result.data?.length ? result.data.map(message => {
    const own = message.sender_id === vantaSession.user.id, quoted = message.reply_to && byId.get(message.reply_to);
    return `<article class="dm-message ${own ? "mine" : "theirs"}" id="dm-${esc(message.id)}">${quoted ? `<button class="dm-reply-ref" onclick="document.querySelector('#dm-${esc(quoted.id)}')?.scrollIntoView({behavior:'smooth',block:'center'})">↳ ${quoted.sender_id === vantaSession.user.id ? "You" : esc(currentDM.display_name)}: ${esc(quoted.content.slice(0,80))}</button>` : ""}<div>${formatMessageText(message.content).replace(/\n/g, "<br>")}</div><small>${own ? "You" : esc(currentDM.display_name)} · ${new Date(message.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</small><div class="dm-actions"><button onclick="replyDM('${esc(message.id)}')">Reply</button>${own ? `<button onclick="editDMMessage('${esc(message.id)}')">Edit</button><button onclick="deleteDMMessage('${esc(message.id)}')">Delete</button>` : ""}</div></article>`;
  }).join("") : '<div class="empty-directory">This is the start of your conversation. Say hello.</div>';
  history.scrollTop = history.scrollHeight;
}

async function sendDMMessage() {
  const input = document.querySelector("#dmMessageInput"), text = input?.value.trim();
  if (!text || !currentDM || !vantaSession) return;
  const state = await vantaDb.from("member_moderation").select("muted_until,last_reason").eq("user_id", vantaSession.user.id).maybeSingle();
  if (state.data?.muted_until && Date.parse(state.data.muted_until) > Date.now()) { toast(`Messaging is paused until ${new Date(state.data.muted_until).toLocaleTimeString()}. ${state.data.last_reason || ""}`); return; }
  const result = await vantaDb.from("direct_messages").insert({ sender_id: vantaSession.user.id, recipient_id: currentDM.id, content: text, reply_to: currentDMReply });
  if (result.error) { toast("Message did not send: " + result.error.message); return; }
  input.value = ""; currentDMReply = null; document.querySelector("#dmReplyBanner")?.remove(); await loadDMHistory(); await loadRecentDMs(); input.focus();
}

function replyDM(messageId) {
  currentDMReply = messageId;
  document.querySelector("#dmReplyBanner")?.remove();
  const banner = document.createElement("div"); banner.id = "dmReplyBanner"; banner.className = "reply-banner show";
  const message = document.querySelector(`#dm-${CSS.escape(messageId)} div`);
  banner.innerHTML = `Replying to <strong>${esc((message?.textContent || "message").slice(0,70))}</strong><button onclick="currentDMReply=null;document.querySelector('#dmReplyBanner')?.remove()">Cancel</button>`;
  document.querySelector(".dm-compose").before(banner); document.querySelector("#dmMessageInput").focus();
}

function editDMMessage(id) {
  const node = document.querySelector(`#dm-${CSS.escape(id)} > div`);
  showDialog("Edit private message", `<textarea class="field-input" id="dmEditText" rows="4">${esc(node?.textContent || "")}</textarea><div class="dialog-actions"><button class="dialog-btn" onclick="openDM('${esc(currentDM.id)}')">Cancel</button><button class="dialog-btn primary" onclick="saveDMEdit('${esc(id)}')">Save</button></div>`);
}

async function saveDMEdit(id) {
  const content = document.querySelector("#dmEditText").value.trim();
  if (!content) { toast("A message cannot be empty."); return; }
  const result = await vantaDb.from("direct_messages").update({ content, updated_at: new Date().toISOString() }).eq("id", id).eq("sender_id", vantaSession.user.id);
  if (result.error) { toast("Edit did not save: " + result.error.message); return; }
  await openDM(currentDM.id);
}

async function deleteDMMessage(id) {
  const result = await vantaDb.from("direct_messages").delete().eq("id", id).eq("sender_id", vantaSession.user.id);
  if (result.error) { toast("Message did not delete: " + result.error.message); return; }
  await loadDMHistory(); toast("Private message deleted");
}

async function openMemberProfile(userId) {
  const person = peopleDirectory.find(item => item.id === userId) || (vantaSession?.user.id === userId ? { ...vantaProfile, id: userId, display_name: profile.name, status: profile.status, about: profile.about, role: vantaRole } : null);
  if (!person) return;
  const id = person.id;
  const isMod = vantaRole === "moderator" && id !== vantaSession?.user.id;
  const moderation = isMod ? `<div class="moderator-tools"><span class="eyebrow">MODERATOR TOOLS</span><input class="field-input" id="moderationReason" maxlength="180" placeholder="Reason for warning or timeout"><div class="moderator-actions"><button class="dialog-btn" onclick="runModeration('${esc(id)}','warn')">Warn</button><button class="dialog-btn" onclick="runModeration('${esc(id)}','timeout')">Timeout 10m</button><button class="dialog-btn" onclick="runModeration('${esc(id)}','clear_timeout')">Clear timeout</button><button class="dialog-btn" onclick="runModeration('${esc(id)}','${person.role === "moderator" ? "demote" : "promote"}')">${person.role === "moderator" ? "Remove moderator" : "Make moderator"}</button><button class="dialog-btn" onclick="runModeration('${esc(id)}','${person.account_disabled ? "enable" : "disable"}')">${person.account_disabled ? "Restore account" : "Disable account on this site"}</button></div></div>` : "";
  const linkedId = isMod ? id : id.slice(0, 8) + "…";
  showDialog(esc(person.display_name), `<div class="member-profile"><div class="profile-avatar">${esc(initials(person.display_name))}</div><div><h3>${esc(person.display_name)} ${person.role === "moderator" ? '<span class="role">MODERATOR</span>' : ""} ${person.account_disabled ? '<span class="role">DISABLED</span>' : ""}</h3><p>${esc(person.status || "")}</p></div></div><p>${esc(person.about || "")}</p><div class="id-card"><span>${isMod ? "Linked account ID" : "Member ID"}</span><code>${esc(linkedId)}</code></div><button class="dialog-btn primary" onclick="openDM('${esc(id)}')" ${person.account_disabled ? "disabled" : ""}>Start a DM ↗</button>${moderation}`);
}

async function runModeration(userId, action) {
  if (vantaRole !== "moderator") { toast("Moderator access required."); return; }
  const reason = action === "warn" || action === "timeout" || action === "disable" ? (document.querySelector("#moderationReason")?.value || "Moderator action") : "";
  const result = await vantaDb.rpc("moderate_member", { target_user: userId, moderation_action: action, duration_minutes: action === "timeout" ? 10 : null, reason_text: reason });
  if (result.error) { toast("Action did not apply: " + result.error.message); return; }
  await loadPeopleDirectory(); toast(action === "warn" ? "Warning recorded" : action === "timeout" ? "Member timed out for 10 minutes" : action === "promote" ? "Moderator role added" : action === "demote" ? "Moderator role removed" : action === "disable" ? "Account disabled on this site" : action === "enable" ? "Account restored" : "Timeout cleared");
  const person = peopleDirectory.find(item => item.id === userId); if (person) openMemberProfile(userId); else closeDialog();
}

async function openModeratorDashboard() {
  if (vantaRole !== "moderator") { toast("Moderator access required."); return; }
  await loadPeopleDirectory();
  showDialog("Moderator desk", `<div class="profile-account"><span class="eyebrow">COMMUNITY OPERATIONS</span><h3>Everything in its proper folder.</h3><p>Manage member roles, warnings, and short timeouts from a profile card. The server is still one server; paperwork remains finite.</p><div class="dialog-actions"><button class="dialog-btn" onclick="openWorkspace()">Edit server details</button><button class="dialog-btn" onclick="newDM()">Find a member</button></div></div><label class="directory-search"><span>⌕</span><input id="modSearch" placeholder="Find a member to manage" oninput="renderModeratorList(this.value)"></label><div id="moderatorMembers" class="people-results"></div>`);
  renderModeratorList();
}

function renderModeratorList(query = "") {
  const box = document.querySelector("#moderatorMembers"); if (!box) return;
  const q = query.toLowerCase().trim(), people = peopleDirectory.filter(person => !q || `${person.display_name} ${person.status || ""}`.toLowerCase().includes(q));
  box.innerHTML = people.map(person => `<button class="person-result" onclick="openMemberProfile('${esc(person.id)}')"><span class="avatar">${esc(initials(person.display_name))}</span><span class="person-copy"><strong>${esc(person.display_name)}</strong><small>${person.account_disabled ? "Disabled" : person.role === "moderator" ? "Moderator" : "Member"} · ${esc(person.status || "")}</small></span><span class="person-action">Manage ↗</span></button>`).join("") || '<div class="empty-directory">No matching members.</div>';
}

function downloadChatHistory() {
  const messages = data[current] || [];
  if (!messages.length) { toast("There is nothing to export yet."); return; }
  const lines = [`# ${workspaceSettings.name} — #${channelLabel(current)}`, `Exported ${new Date().toLocaleString()}`, "", ...messages.map(message => `[${message.time}] ${message.user}: ${message.text}${message.files?.length ? " [attachments: " + message.files.map(file => file.name).join(", ") + "]" : ""}`)];
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }), url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = `chat-${current}-${new Date().toISOString().slice(0,10)}.txt`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast("Room transcript downloaded");
}

function trackTyping() {
  if (!presenceRealtime || !vantaSession) return;
  const track = typing => presenceRealtime.track({ id: vantaSession.user.id, name: profile.name, channel: current, role: vantaRole, typing });
  track(true); clearTimeout(typingTimer); typingTimer = setTimeout(() => track(false), 1600);
}

function openMentionPicker() {
  if (!vantaSession) { toast("Sign in to mention members."); return; }
  showDialog("Mention a member", `<label class="directory-search"><span>⌕</span><input id="mentionSearch" placeholder="Find a member" oninput="renderMentionList(this.value)"></label><div id="mentionResults" class="people-results"></div>`);
  if (!peopleDirectory.length) loadPeopleDirectory().then(() => renderMentionList()); else renderMentionList();
}

function renderMentionList(query = "") {
  const q = query.toLowerCase().trim();
  const results = document.querySelector("#mentionResults");
  if (!results) return;
  const matches = peopleDirectory.filter(person => !q || person.display_name.toLowerCase().includes(q));
  results.innerHTML = matches.length ? matches.map(person => `<button class="person-result" onclick="insertMention('${esc(person.display_name)}')"><span class="avatar">${esc(initials(person.display_name))}</span><span class="person-copy"><strong>${esc(person.display_name)}</strong><small>${esc(person.status || "Around")}</small></span><span class="person-action">Mention @</span></button>`).join("") : '<div class="empty-directory">No matching members.</div>';
}

function insertMention(name) {
  const input = document.querySelector("#messageInput"), value = input.value;
  const at = value.lastIndexOf("@");
  input.value = (at >= 0 ? value.slice(0, at) : value + " ") + "@" + name.replace(/\s+/g, "") + " ";
  input.focus(); input.dispatchEvent(new Event("input", { bubbles: true })); closeDialog();
}

function formatMessageText(text) {
  return esc(text).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/(^|\s)@([\p{L}\p{N}_.-]+)/gu, '$1<span class="mention">@$2</span>');
}

function formatMessageDate() {
  const target = document.querySelector("#dayMarker");
  if (target) target.textContent = "TODAY · " + new Intl.DateTimeFormat([], { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase();
}

const baseRenderNocturne = renderNocturneBase;
function render() { baseRenderNocturne(); document.querySelectorAll('#messages .message').forEach((node,index)=>{const content=node.querySelector('.msg-content');if(content&&data[current]?.[index])content.innerHTML=formatMessageText(data[current][index].text)}); }

const baseApplySessionNocturne = applyNocturneSessionBase;
async function applyNocturneSession(session) {
  await baseApplySessionNocturne(session);
  if (!vantaSession) return;
  const result = await vantaDb.from("profiles").select("id,display_name,status,about,role,theme,username_changed_at,account_disabled").eq("id", session.user.id).maybeSingle();
  if (!result.error) {
    vantaProfile = result.data;
    if (result.data?.account_disabled) { await vantaDb.auth.signOut(); vantaSession = null; vantaRole = "member"; accountUI(); showDialog("Account unavailable", "A moderator has disabled this account on this site. Contact a moderator if you think this was a mistake."); return; }
    profile.id = session.user.id;
    document.querySelector("#miniStatus").textContent = `${profile.status || "Around"} · ${vantaRole === "moderator" ? "Moderator" : "online"}`;
  }
  await loadPeopleDirectory();
}

formatMessageDate();
document.querySelector("#messageInput")?.addEventListener("input", trackTyping);
document.querySelector("#messageInput")?.addEventListener("blur", () => { clearTimeout(typingTimer); if (presenceRealtime && vantaSession) presenceRealtime.track({ id: vantaSession.user.id, name: profile.name, channel: current, role: vantaRole, typing: false }); });
document.querySelector("#miniName").textContent = profile.name || "Create an account";
document.querySelector("#miniStatus").textContent = profile.status || "Not signed in";
document.querySelector("#miniInitial").textContent = initials(profile.name);

async function signOutNocturne() {
  const result = await vantaDb.auth.signOut();
  if (result.error) { toast(result.error.message); return; }
  for (const channel of [roomRealtime, presenceRealtime, settingsRealtime, dmRealtime]) if (channel) await vantaDb.removeChannel(channel);
  clearTimeout(typingTimer); vantaSession = null; vantaRole = "member"; vantaProfile = null; peopleDirectory = []; currentDM = null; currentDMReply = null; document.querySelector("#dmList").dataset.recent = "";
  roomRealtime = presenceRealtime = settingsRealtime = dmRealtime = null;
  profile = { name: "", status: "", about: "" };
  data = { ...seed }; document.querySelector("#miniName").textContent = "Create an account"; document.querySelector("#miniStatus").textContent = "Not signed in";
  document.querySelector("#miniInitial").textContent = initials(profile.name);
  document.querySelector("#dmList").innerHTML = '<div class="dm-empty">Sign in to find members.</div>';
  accountUI(); closeDialog(); render(); toast("Signed out");
}



