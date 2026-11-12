// Cross-device accounts and realtime room sync. This runs after the UI's inline script.
let vantaDb = null;
let vantaSession = null;
let vantaRole = "member";
let roomRealtime = null;
let presenceRealtime = null;
let settingsRealtime = null;
let workspaceSettings = {
  name: localStorage.getItem("vanta-space-name") || "Afterhours Club",
  description: localStorage.getItem("vanta-space-description") || "A little space for big ideas."
};

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
  const accountButton = document.querySelector("#accountBtn");
  const status = document.querySelector("#miniStatus");
  const liveCount = document.querySelector("#liveCount");
  if (accountButton) {
    accountButton.textContent = signedIn ? "●" : "↗";
    accountButton.title = signedIn ? `Signed in as ${vantaSession.user.email}` : "Create an account to sync across computers";
  }
  if (status) status.textContent = signedIn ? (vantaRole === "moderator" ? "Moderator · online" : "Synced account · online") : vantaDb ? "Sign in to sync across computers" : "Local preview · setup needed";
  if (liveCount && !signedIn) liveCount.textContent = vantaDb ? "Sign in to see members" : "Demo members";
  const memberList = document.querySelector("#memberList");
  if (memberList && vantaDb && !signedIn) memberList.innerHTML = '<div style="font-size:10px;color:var(--muted);padding:8px 4px">Sign in to see who is around.</div>';
}

function openAccount() {
  if (!vantaDb) {
    showDialog("Set up cross-device accounts", `<p>Vanta is currently a local preview. To let people create profiles and share room messages across computers, connect a free Supabase project.</p><ol><li>Create a Supabase project.</li><li>Run <b>supabase-schema.sql</b> in its SQL Editor.</li><li>Copy <b>config.example.js</b> to <b>config.js</b> and add the project URL and publishable key.</li><li>Publish the site again, then create an account here.</li></ol><p>Never put a service-role key in a website.</p><a href="https://supabase.com/dashboard" target="_blank" rel="noopener" class="dialog-btn primary">Open Supabase ↗</a>`);
    return;
  }
  if (vantaSession) {
    showDialog("Your Vanta account", `<p>Signed in as <b>${esc(vantaSession.user.email)}</b>. Your profile and room messages sync to this account.</p><button class="dialog-btn" onclick="openProfile()">Edit your profile</button><div class="dialog-actions"><button class="dialog-btn" onclick="closeDialog()">Close</button><button class="dialog-btn primary" onclick="signOutVanta()">Sign out</button></div>`);
    return;
  }
  showDialog("Join the conversation", `<p>Create one account and use it to keep your profile and room messages with you on any computer.</p><label class="field">DISPLAY NAME</label><input class="field-input" id="authName" maxlength="28" autocomplete="nickname" placeholder="How people will know you"><label class="field">EMAIL</label><input class="field-input" id="authEmail" type="email" autocomplete="email" placeholder="you@example.com"><label class="field">PASSWORD</label><input class="field-input" id="authPassword" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters"><div id="authError" style="font-size:10px;color:var(--danger);margin-top:8px"></div><div class="dialog-actions"><button class="dialog-btn" onclick="authenticateVanta('login')">Sign in</button><button class="dialog-btn primary" onclick="authenticateVanta('signup')">Create account</button></div><p style="margin-bottom:0">You may need to confirm your email before signing in.</p>`);
}

async function authenticateVanta(mode) {
  const email = document.querySelector("#authEmail").value.trim();
  const password = document.querySelector("#authPassword").value;
  const name = document.querySelector("#authName").value.trim() || "New member";
  const error = document.querySelector("#authError");
  if (!email || !password) { error.textContent = "Enter your email and password."; return; }
  if (mode === "signup" && password.length < 8) { error.textContent = "Use a password with at least 8 characters."; return; }
  error.textContent = "";
  const result = mode === "signup"
    ? await vantaDb.auth.signUp({ email, password, options: { data: { display_name: name } } })
    : await vantaDb.auth.signInWithPassword({ email, password });
  if (result.error) { error.textContent = result.error.message; return; }
  if (result.data.session) {
    await applyVantaSession(result.data.session);
    closeDialog();
    toast(mode === "signup" ? "Your Vanta account is ready" : "Welcome back");
  } else {
    showDialog("Check your email", `<p>Supabase sent a verification link to <b>${esc(email)}</b>. Confirm your address, then come back here to sign in.</p><button class="dialog-btn primary" onclick="closeDialog()">Okay</button>`);
  }
}

async function signOutVanta() {
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

async function applyVantaSession(session) {
  if (!vantaDb || !session) return;
  vantaSession = session;
  const result = await vantaDb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  if (result.error) { toast("Could not load profile: " + result.error.message); return; }
  let row = result.data;
  if (!row) {
    const candidate = { id: session.user.id, display_name: session.user.user_metadata?.display_name || "New member", status: "Around", about: "", theme: "midnight" };
    const created = await vantaDb.from("profiles").upsert(candidate).select().single();
    if (created.error) { toast("Profile setup failed: " + created.error.message); return; }
    row = created.data;
  }
  profile = { name: row.display_name, status: row.status, about: row.about };
  vantaRole = row.role || "member";
  document.querySelector("#miniName").textContent = profile.name;
  document.querySelector("#miniAvatar").firstChild.textContent = initials(profile.name);
  document.querySelector("#railInitial").textContent = initials(profile.name);
  if (row.theme && themes.some(theme => theme[0] === row.theme)) document.documentElement.dataset.theme = row.theme;
  await loadWorkspaceSettings();
  accountUI();
  await startVantaPresence();
  await startWorkspaceRealtime();
  subscribeVantaRoom();
}

async function loadVantaRoom() {
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

function subscribeVantaRoom() {
  if (!vantaDb || !vantaSession) return;
  if (roomRealtime) vantaDb.removeChannel(roomRealtime);
  roomRealtime = vantaDb.channel("vanta-room-" + current)
    .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `channel=eq.${current}` }, loadVantaRoom)
    .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, loadVantaRoom)
    .subscribe();
  loadVantaRoom();
}

async function startVantaPresence() {
  if (!vantaDb || !vantaSession) return;
  if (presenceRealtime) await vantaDb.removeChannel(presenceRealtime);
  presenceRealtime = vantaDb.channel("vanta-presence", { config: { presence: { key: vantaSession.user.id } } })
    .on("presence", { event: "sync" }, renderVantaMembers)
    .subscribe(status => { if (status === "SUBSCRIBED") presenceRealtime.track({ name: profile.name, channel: current, role: vantaRole }); });
}

function renderVantaMembers() {
  if (!presenceRealtime) return;
  const members = Object.values(presenceRealtime.presenceState()).flat();
  document.querySelector("#liveCount").textContent = members.length + " online";
  document.querySelector("#memberList").innerHTML = members.map(member => {
    const name = member.name || "Member";
    return `<div class="member-row" data-name="${esc(name)}"><div class="avatar" style="background:${esc(colorFor(name))}">${esc(initials(name))}</div><div><strong>${esc(name)}</strong><small>in #${esc(channelLabel(member.channel || "lobby"))}</small></div>${member.role === "moderator" ? '<span class="role">MOD</span>' : ''}<span class="member-badge">●</span></div>`;
  }).join("") || '<div style="font-size:10px;color:var(--muted);padding:8px 4px">No one is online right now.</div>';
}

function selectChannel(element) {
  current = element.dataset.channel;
  document.querySelectorAll(".nav-item[data-channel]").forEach(item => item.classList.toggle("active", item === element));
  const label = channelLabel(current);
  document.querySelector("#channelTitle").textContent = label;
  document.querySelector("#welcomeTitle").textContent = current === "lobby" ? "Welcome to the lobby." : `A fresh page in ${label}.`;
  document.querySelector("#welcomeDesc").textContent = current === "lobby" ? "A good place to begin, pick up a thought, or just say hi." : `Pull up a chair. This is your corner for ${label}.`;
  document.querySelector("#messageInput").placeholder = `Leave a thought in #${current}…`;
  document.querySelector("#topicIcon").textContent = current === "lobby" ? "◌" : "✳";
  document.querySelector("#introMark").textContent = current === "lobby" ? "◌" : "✳";
  document.querySelector("#channelDesc").textContent = current === "lobby" ? "Casual conversation, unexpected recommendations, and good energy." : `A calm corner to share ideas about ${label}.`;
  render(); toggleSide(false); document.querySelector("#searchInput").value = ""; searchMessages("");
  if (vantaSession) { if (presenceRealtime) presenceRealtime.track({ name: profile.name, channel: current, role: vantaRole }); subscribeVantaRoom(); }
}

async function sendMessage() {
  const box = document.querySelector("#messageInput"), text = box.value.trim();
  if (!text && !attachments.length) return;
  if (text.length > 2000) { toast("Messages can be up to 2,000 characters"); return; }
  if (vantaDb && !vantaSession) { toast("Sign in to post to the shared room"); openAccount(); return; }
  if (vantaDb && vantaSession) {
    const result = await vantaDb.from("messages").insert({ channel: current, user_id: vantaSession.user.id, content: text, files: attachments.map(file => ({ name: file.name, type: file.type, data: file.data || null })), reply_to: replyTo });
    if (result.error) { toast("Message not sent: " + result.error.message); return; }
    box.value = ""; box.style.height = "auto"; document.querySelector("#draftCount").textContent = "0 / 2000"; attachments = []; cancelReply(); await loadVantaRoom(); box.focus(); return;
  }
  const message = { id: "m" + Date.now() + Math.random().toString(16).slice(2, 6), user: profile.name, initial: initials(profile.name), color: "linear-gradient(140deg,var(--a),var(--c))", time: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), text, reactions: [], files: attachments };
  if (replyTo) message.replyTo = replyTo;
  data[current] ??= []; data[current].push(message); save(); box.value = ""; box.style.height = "auto"; document.querySelector("#draftCount").textContent = "0 / 2000"; attachments = []; cancelReply(); render(); box.focus();
}

async function react(index, reactionIndex) {
  if (vantaDb && vantaSession) {
    const message = data[current][index], emoji = message.reactions[reactionIndex].replace(/\s+\d+$/, "");
    const existing = await vantaDb.from("message_reactions").select("id").eq("message_id", message.id).eq("user_id", vantaSession.user.id).eq("emoji", emoji).maybeSingle();
    if (existing.error) { toast(existing.error.message); return; }
    const result = existing.data ? await vantaDb.from("message_reactions").delete().eq("id", existing.data.id) : await vantaDb.from("message_reactions").insert({ message_id: message.id, user_id: vantaSession.user.id, emoji });
    if (result.error) { toast("Reaction failed: " + result.error.message); return; }
    await loadVantaRoom(); return;
  }
  const parts = data[current][index].reactions[reactionIndex].split(" "), count = +(parts.at(-1) || 1);
  data[current][index].reactions[reactionIndex] = parts.slice(0, -1).join(" ") + " " + (count + 1); save(); render();
}

async function addReactionEmoji(index, emoji) {
  if (vantaDb && vantaSession) {
    const result = await vantaDb.from("message_reactions").insert({ message_id: data[current][index].id, user_id: vantaSession.user.id, emoji });
    if (result.error && result.error.code !== "23505") { toast("Reaction failed: " + result.error.message); return; }
    await loadVantaRoom(); closeDialog(); return;
  }
  data[current][index].reactions ??= []; data[current][index].reactions.push(emoji + " 1"); save(); closeDialog(); render();
}

function openProfile() {
  showDialog("Your profile", `<p>${vantaSession ? "Your profile follows your account across computers." : "This preview profile is stored on this device. Sign in to sync it across computers."}</p><label class="field">DISPLAY NAME</label><input class="field-input" id="profileName" maxlength="28" value="${esc(profile.name)}"><label class="field">STATUS LINE</label><input class="field-input" id="profileStatus" maxlength="48" value="${esc(profile.status)}"><label class="field">A LITTLE ABOUT YOU</label><textarea class="field-input" id="profileAbout" rows="3" maxlength="160">${esc(profile.about)}</textarea><div class="dialog-actions"><button class="dialog-btn" onclick="closeDialog()">Cancel</button><button class="dialog-btn primary" onclick="saveProfile()">Save profile</button></div>`);
}

async function saveProfile() {
  profile.name = document.querySelector("#profileName").value.trim() || "Alex Morgan";
  profile.status = document.querySelector("#profileStatus").value.trim() || "Around";
  profile.about = document.querySelector("#profileAbout").value.trim();
  localStorage.setItem("vanta-name", profile.name); localStorage.setItem("vanta-status", profile.status); localStorage.setItem("vanta-about", profile.about);
  document.querySelector("#miniName").textContent = profile.name; document.querySelector("#miniAvatar").firstChild.textContent = initials(profile.name); document.querySelector("#railInitial").textContent = initials(profile.name);
  if (vantaDb && vantaSession) {
    const result = await vantaDb.from("profiles").update({ display_name: profile.name, status: profile.status, about: profile.about, theme: document.documentElement.dataset.theme, updated_at: new Date().toISOString() }).eq("id", vantaSession.user.id);
    if (result.error) { toast("Profile did not sync: " + result.error.message); return; }
    if (presenceRealtime) presenceRealtime.track({ name: profile.name, channel: current, role: vantaRole });
  }
  closeDialog(); toast("Profile saved" + (vantaSession ? " and synced" : " on this device"));
}

function setTheme(id) {
  document.documentElement.dataset.theme = id; localStorage.setItem("vanta-theme", id);
  if (vantaDb && vantaSession) vantaDb.from("profiles").update({ theme: id, updated_at: new Date().toISOString() }).eq("id", vantaSession.user.id);
  openThemes(); toast(`${themes.find(theme => theme[0] === id)[1]} theme applied`);
}

async function saveEdit(id) {
  const text = document.querySelector("#editText").value.trim();
  if (vantaDb && vantaSession) {
    const result = await vantaDb.from("messages").update({ content: text, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", vantaSession.user.id);
    if (result.error) { toast("Edit failed: " + result.error.message); return; }
    closeDialog(); await loadVantaRoom(); return;
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
  showDialog(workspaceSettings.name, `<p>One community space for rooms, conversations, and direct messages.</p>${editor}`);
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

function render() {
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
    closeDialog(); await loadVantaRoom(); toast("Message removed"); return;
  }
  data[current] = data[current].filter(message => message.id !== id); pins = pins.filter(pin => pin !== id); save(); closeDialog(); render(); toast("Message deleted");
}

async function copyInvite() {
  const link = location.href;
  try { await navigator.clipboard.writeText(link); toast("Invite link copied"); }
  catch { showDialog("Invite to Vanta", `<p>Copy this link and share it with your members.</p><input class="field-input" id="inviteLink" readonly value="${esc(link)}"><div class="dialog-actions"><button class="dialog-btn primary" onclick="document.querySelector('#inviteLink').select();toast('Select and copy the link')">Select link</button></div>`); }
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
  const dmElement = event.target.closest(".nav-item.dm");
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
    const name = dmElement.querySelector(".nav-label")?.textContent || "Member";
    showContextMenu(event, "DIRECT MESSAGE", [{ label: "Open conversation with " + name, action: () => openDM(name) }]); return;
  }
  if (memberElement) {
    const name = memberElement.dataset.name || memberElement.querySelector("strong")?.textContent || "Member";
    showContextMenu(event, "MEMBER", [{ label: "Message " + name, action: () => openDM(name) }, { label: "View profile", action: () => showDialog(name, `<p>Member of ${esc(workspaceSettings.name)}.</p><button class="dialog-btn primary" onclick="closeDialog();openDM('${esc(name)}')">Send a direct message</button>`) }]); return;
  }
  if (workspaceElement) {
    const items = [{ label: "Copy invite link", action: copyInvite }];
    if (!vantaDb || vantaRole === "moderator") items.unshift({ label: "Edit server settings", action: openWorkspace });
    showContextMenu(event, workspaceSettings.name, items); return;
  }
  showContextMenu(event, "VANTA", [{ label: "Edit server settings", action: openWorkspace }, { label: "Change theme", action: openThemes }, { label: "Edit your profile", action: openProfile }, { label: "Start a direct message", action: newDM }]);
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
    if (session) setTimeout(() => applyVantaSession(session), 0);
    else { vantaSession = null; vantaRole = "member"; if (roomRealtime) vantaDb.removeChannel(roomRealtime); if (presenceRealtime) vantaDb.removeChannel(presenceRealtime); if (settingsRealtime) vantaDb.removeChannel(settingsRealtime); roomRealtime = presenceRealtime = settingsRealtime = null; accountUI(); data = { ...seed }; render(); }
  });
}



