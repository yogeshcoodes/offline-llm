(function () {
    console.log("Aether AI script starting... (Multi-API support with fallback)");

    // ==================== LOCAL MODEL BRIDGE ====================
    let pendingCallbacks = {};
    let modelReady = false;

    window.onModelResponse = function (callbackId, text) {
        if (pendingCallbacks[callbackId]) {
            pendingCallbacks[callbackId](text);
            delete pendingCallbacks[callbackId];
        }
    };

    function waitForBridge() {
        return new Promise((resolve) => {
            const check = setInterval(() => {
                if (window.AndroidTFLite) {
                    clearInterval(check);
                    modelReady = true;
                    resolve();
                }
            }, 200);
            setTimeout(() => {
                clearInterval(check);
                if (!window.AndroidTFLite) {
                    console.warn("AndroidTFLite bridge not detected after timeout.");
                    resolve();
                }
            }, 20000);
        });
    }

    function askLocalLLM(prompt, onSuccess, onError) {
        if (!modelReady || !window.AndroidTFLite) {
            onError("Local model not ready. Please wait for the engine to initialize.");
            return;
        }
        const callbackId = Date.now() + '_' + Math.random();
        pendingCallbacks[callbackId] = onSuccess;
        try {
            window.AndroidTFLite.runModel(prompt, callbackId);
        } catch (e) {
            delete pendingCallbacks[callbackId];
            onError("Bridge error: " + e.message);
        }
    }

    // ==================== MULTI-PROVIDER API CALL ====================
    async function callAIAPI(prompt, apiKey) {
        const key = apiKey.trim();
        if (!key) throw new Error("No API key provided");

        // Detect provider based on key prefix
        if (key.startsWith("gsk_")) {
            return await callGroqAPI(prompt, key);
        } else if (key.startsWith("sk-")) {
            return await callOpenAIAPI(prompt, key);
        } else if (key.startsWith("AIza") || key.length >= 30) {
            return await callGeminiAPI(prompt, key);
        } else {
            console.warn("Unknown API key format, trying Gemini...");
            return await callGeminiAPI(prompt, key);
        }
    }

    // ---- Gemini API ----
    async function callGeminiAPI(prompt, apiKey) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
        const requestBody = {
            contents: [{ parts: [{ text: prompt }] }]
        };
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini API error (${response.status}): ${errorText}`);
        }
        const data = await response.json();
        const candidates = data.candidates;
        if (!candidates || candidates.length === 0) throw new Error('Gemini: No response');
        const content = candidates[0].content;
        if (!content || !content.parts || content.parts.length === 0) throw new Error('Gemini: Missing content');
        return content.parts[0].text;
    }

    // ---- Groq API (with model fallback) ----
    const GROQ_MODELS = [
        "llama-3.3-70b-versatile",  // primary (replaces decommissioned llama3-70b)
        "llama-3.1-8b-instant",
        "gemma2-9b-it",
        "qwen-2.5-32b"
    ];

    async function callGroqAPI(prompt, apiKey) {
        let lastError = null;

        for (const model of GROQ_MODELS) {
            try {
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [{ role: "user", content: prompt }],
                        temperature: 0.7
                    })
                });

                if (!response.ok) {
                    const errText = await response.text();
                    const errorObj = JSON.parse(errText);
                    // If model decommissioned or not found, try next model
                    if (errorObj.error?.message?.toLowerCase().includes("decommissioned") ||
                        errorObj.error?.message?.toLowerCase().includes("not found")) {
                        console.warn(`Groq model ${model} decommissioned, trying next...`);
                        continue;
                    }
                    throw new Error(`Groq API error (${response.status}): ${errText}`);
                }

                const data = await response.json();
                if (!data.choices || data.choices.length === 0) throw new Error("Groq: No response");
                return data.choices[0].message.content;
            } catch (err) {
                lastError = err;
                // Continue to next model only if it's a model-related error
                if (err.message.includes("decommissioned") || err.message.includes("not found")) {
                    continue;
                }
                throw err; // other errors (rate limit, network) abort fallback
            }
        }
        throw new Error(`All Groq models failed. Last error: ${lastError?.message || "Unknown"}`);
    }

    // ---- OpenAI API ----
    async function callOpenAIAPI(prompt, apiKey) {
        const url = "https://api.openai.com/v1/chat/completions";
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "gpt-3.5-turbo",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.7
            })
        });
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`OpenAI API error (${response.status}): ${errText}`);
        }
        const data = await response.json();
        if (!data.choices || data.choices.length === 0) throw new Error("OpenAI: No response");
        return data.choices[0].message.content;
    }

    // ==================== DOM REFS ====================
    const app = document.getElementById('app');
    const splashOverlay = document.getElementById('splashOverlay');
    const splashLogoImg = document.getElementById('splashLogoImg');
    const welcomeScreen = document.getElementById('welcomeScreen');
    const chatArea = document.getElementById('chatArea');
    const welcomeInputContainer = document.getElementById('welcomeInputContainer');
    const chatInputWrapper = document.getElementById('chatInputWrapper');
    const welcomeUserInput = document.getElementById('welcomeUserInput');
    const userInput = document.getElementById('userInput');
    const btnSendWelcome = document.getElementById('btnSendWelcome');
    const btnSend = document.getElementById('btnSend');
    const toast = document.getElementById('toast');
    const settingsModalOverlay = document.getElementById('settingsModalOverlay');
    const confirmClearDialog = document.getElementById('confirmClearDialog');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const themeBtn = document.getElementById('btnThemeToggle');
    const themeLabel = themeBtn.querySelector('.theme-label');
    const themeIcon = document.getElementById('themeIcon');
    const desktopSidebarToggle = document.getElementById('desktopSidebarToggle');
    const welcomeLogo = document.getElementById('welcomeLogo');
    const desktopNewChatBtn = document.getElementById('desktopNewChatBtn');
    const mobileNewChatBtn = document.getElementById('mobileNewChatBtn');
    const desktopMenuBtn = document.getElementById('desktopMenuBtn');
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const dropdownMenu = document.getElementById('dropdownMenu');
    const mobileDropdownMenu = document.getElementById('mobileDropdownMenu');
    const sendOnEnterCheckbox = document.getElementById('sendOnEnter');
    const accentCircles = document.querySelectorAll('.accent-circle');
    const chatList = document.getElementById('chatList');
    const noRecentChats = document.getElementById('noRecentChats');
    const searchInput = document.getElementById('searchInput');
    const customInstructionsInput = document.getElementById('customInstructions');
    const apiKeyInput = document.getElementById('apiKeyInput');

    // ==================== STATE ====================
    let currentConversation = [];
    let typingIndicatorEl = null;
    let sendOnEnter = true;
    let activeInput = 'welcome';
    let currentAccent = localStorage.getItem('accent') || '#2A7CCC';
    let allConversations = [];
    let activeConversationId = null;
    let customInstructions = localStorage.getItem('customInstructions') || '';
    let apiKey = localStorage.getItem('apiKey') || '';

    function applyAccent(color) {
        currentAccent = color;
        document.documentElement.style.setProperty('--primary', color);
        document.documentElement.style.setProperty('--message-user-bg', color);
        localStorage.setItem('accent', color);
        accentCircles.forEach(c => c.classList.toggle('active', c.getAttribute('data-color') === color));
    }
    applyAccent(currentAccent);
    accentCircles.forEach(c => c.addEventListener('click', () => applyAccent(c.getAttribute('data-color'))));

    customInstructionsInput.value = customInstructions;
    function saveCustomInstructions(val) { customInstructions = val; localStorage.setItem('customInstructions', val); }
    apiKeyInput.value = apiKey;

    function showToast(msg, duration = 2500) {
        toast.textContent = msg; toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, duration);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m])
            .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, c => c);
    }

    function appendMessage(role, content) {
        if (welcomeScreen.style.display !== 'none') {
            welcomeScreen.style.display = 'none';
            chatArea.style.display = 'flex';
            setActiveInput('chat');
        }
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${role === 'user' ? 'user' : 'ai'}`;
        wrapper.setAttribute('data-content', content);
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        wrapper.innerHTML = `
            <div class="message ${role === 'user' ? 'user-message' : 'ai-message'}">
                <div class="message-text">${escapeHtml(content)}</div>
                <div class="message-footer"><span class="message-time">${time}</span></div>
            </div>
            <button class="copy-msg-btn" title="Copy message">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            </button>
        `;
        chatArea.appendChild(wrapper);
        chatArea.scrollTop = chatArea.scrollHeight;
        currentConversation.push({ role, content, timestamp: Date.now() });

        if (role === 'user' && !activeConversationId && currentConversation.filter(m => m.role === 'user').length === 1) saveCurrentConversation(true);
        if (role === 'user' && activeConversationId && currentConversation.filter(m => m.role === 'user').length === 1) updateConversationTitle(activeConversationId, content);
    }

    function showTypingIndicator(show) {
        if (show && !typingIndicatorEl) {
            const div = document.createElement('div'); div.className = 'typing-indicator';
            div.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
            chatArea.appendChild(div); chatArea.scrollTop = chatArea.scrollHeight; typingIndicatorEl = div;
        } else if (!show && typingIndicatorEl) { typingIndicatorEl.remove(); typingIndicatorEl = null; }
    }

    function setActiveInput(type) {
        activeInput = type;
        welcomeInputContainer.style.display = type === 'welcome' ? 'block' : 'none';
        chatInputWrapper.style.display = type === 'chat' ? 'block' : 'none';
    }

    function generateChatTitle(content) {
        const cleaned = (content || '').replace(/\s+/g, ' ').trim();
        return cleaned.length > 28 ? cleaned.substring(0, 28) + '...' : (cleaned || 'New Chat');
    }

    function saveCurrentConversation(createNew) {
        if (currentConversation.length === 0) return;
        const firstUserMsg = currentConversation.find(m => m.role === 'user');
        const title = firstUserMsg ? generateChatTitle(firstUserMsg.content) : 'New Chat';
        const id = activeConversationId || ('conv_' + Date.now());
        const conv = { id, title, messages: [...currentConversation], timestamp: Date.now() };
        const idx = allConversations.findIndex(c => c.id === id);
        if (idx >= 0) allConversations[idx] = conv; else allConversations.unshift(conv);
        if (createNew || !activeConversationId) activeConversationId = id;
        renderRecentChats();
    }

    function updateConversationTitle(convId, content) {
        const conv = allConversations.find(c => c.id === convId);
        if (conv) { conv.title = generateChatTitle(content); conv.timestamp = Date.now(); renderRecentChats(); }
    }

    function loadConversation(convId) {
        if (activeConversationId && currentConversation.length > 0) saveCurrentConversation(false);
        const conv = allConversations.find(c => c.id === convId);
        if (!conv) return;
        activeConversationId = convId; currentConversation = [...conv.messages];
        chatArea.innerHTML = ''; typingIndicatorEl = null;
        currentConversation.forEach(msg => {
            const wrapper = document.createElement('div');
            wrapper.className = `message-wrapper ${msg.role === 'user' ? 'user' : 'ai'}`;
            wrapper.setAttribute('data-content', msg.content);
            const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            wrapper.innerHTML = `
                <div class="message ${msg.role === 'user' ? 'user-message' : 'ai-message'}">
                    <div class="message-text">${escapeHtml(msg.content)}</div>
                    <div class="message-footer"><span class="message-time">${time}</span></div>
                </div>
                <button class="copy-msg-btn" title="Copy message"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>
            `;
            chatArea.appendChild(wrapper);
        });
        welcomeScreen.style.display = 'none'; chatArea.style.display = 'flex';
        setActiveInput('chat'); chatArea.scrollTop = chatArea.scrollHeight; renderRecentChats();
    }

    function deleteConversation(convId, e) {
        e.stopPropagation();
        allConversations = allConversations.filter(c => c.id !== convId);
        if (activeConversationId === convId) {
            activeConversationId = null; currentConversation = []; chatArea.innerHTML = ''; typingIndicatorEl = null;
            welcomeScreen.style.display = 'flex'; chatArea.style.display = 'none';
            welcomeUserInput.value = ''; userInput.value = ''; setActiveInput('welcome');
        }
        renderRecentChats(); showToast('Chat deleted');
    }

    function renderRecentChats() {
        chatList.innerHTML = '';
        const q = searchInput.value.trim().toLowerCase();
        let filtered = q ? allConversations.filter(c => c.title.toLowerCase().includes(q)) : allConversations;
        if (filtered.length === 0) { noRecentChats.classList.add('visible'); noRecentChats.textContent = q ? 'No matching chats' : 'No recent chats'; }
        else { noRecentChats.classList.remove('visible'); }
        filtered.forEach(conv => {
            const tile = document.createElement('div');
            tile.className = 'chat-tile' + (conv.id === activeConversationId ? ' active' : '');
            tile.setAttribute('data-chat-id', conv.id);
            tile.innerHTML = `
                <span class="chat-tile-title">${escapeHtml(conv.title)}</span>
                <button class="chat-tile-delete" title="Delete chat"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>
            `;
            tile.addEventListener('click', () => {
                if (conv.id !== activeConversationId) {
                    if (activeConversationId && currentConversation.length) saveCurrentConversation(false);
                    loadConversation(conv.id);
                }
                if (window.innerWidth <= 768) { sidebar.classList.remove('open'); overlay.classList.remove('active'); }
            });
            tile.querySelector('.chat-tile-delete').addEventListener('click', (e) => deleteConversation(conv.id, e));
            chatList.appendChild(tile);
        });
    }

    async function sendMessage() {
        const inputEl = activeInput === 'welcome' ? welcomeUserInput : userInput;
        const sendBtn = activeInput === 'welcome' ? btnSendWelcome : btnSend;
        const text = inputEl.value.trim();
        if (!text) return;
        if (!modelReady && !apiKey) {
            showToast("AI engine not ready. Set API key in Settings or wait.");
            return;
        }

        inputEl.value = ''; inputEl.style.height = 'auto';
        appendMessage('user', text); renderRecentChats();
        showTypingIndicator(true);
        sendBtn.disabled = true;

        let prompt = text;
        if (customInstructions.trim()) prompt = `[Instructions: ${customInstructions.trim()}]\n\nUser: ${text}`;

        const timeoutId = setTimeout(() => {
            if (sendBtn.disabled) {
                showTypingIndicator(false);
                appendMessage('ai', '⚠️ AI is taking too long. Please try again.');
                sendBtn.disabled = false;
            }
        }, 60000);

        try {
            let response;
            if (apiKey) {
                try {
                    response = await callAIAPI(prompt, apiKey);
                } catch (apiErr) {
                    console.warn('Cloud API error:', apiErr);
                    if (modelReady && window.AndroidTFLite) {
                        showToast('API error, trying local model...');
                        response = await new Promise((resolve, reject) => {
                            askLocalLLM(prompt, resolve, reject);
                        });
                    } else {
                        throw new Error(`API call failed: ${apiErr.message}`);
                    }
                }
            } else {
                if (!modelReady || !window.AndroidTFLite) {
                    throw new Error('Local model not ready');
                }
                response = await new Promise((resolve, reject) => {
                    askLocalLLM(prompt, resolve, reject);
                });
            }
            clearTimeout(timeoutId);
            showTypingIndicator(false);
            appendMessage('ai', response);
        } catch (err) {
            clearTimeout(timeoutId);
            showTypingIndicator(false);
            appendMessage('ai', '⚠️ ' + (err.message || 'Unknown error'));
        } finally {
            sendBtn.disabled = false;
            saveCurrentConversation(false); renderRecentChats();
            if (activeInput === 'welcome') welcomeUserInput.focus(); else userInput.focus();
        }
    }

    function newChat() {
        if (currentConversation.length > 0) saveCurrentConversation(false);
        activeConversationId = null; currentConversation = []; chatArea.innerHTML = ''; typingIndicatorEl = null;
        welcomeScreen.style.display = 'flex'; chatArea.style.display = 'none';
        welcomeUserInput.value = ''; userInput.value = ''; setActiveInput('welcome');
        renderRecentChats();
        if (window.AndroidTFLite && typeof window.AndroidTFLite.resetChat === 'function') window.AndroidTFLite.resetChat();
    }

    function clearChat() { confirmClearDialog.classList.remove('hidden'); }
    function performClearChat() {
        if (activeConversationId) allConversations = allConversations.filter(c => c.id !== activeConversationId);
        activeConversationId = null; currentConversation = []; chatArea.innerHTML = ''; typingIndicatorEl = null;
        welcomeScreen.style.display = 'flex'; chatArea.style.display = 'none';
        welcomeUserInput.value = ''; userInput.value = ''; setActiveInput('welcome');
        renderRecentChats();
        if (window.AndroidTFLite && typeof window.AndroidTFLite.resetChat === 'function') window.AndroidTFLite.resetChat();
    }

    function exportChat() {
        if (currentConversation.length === 0) { showToast('Nothing to export'); return; }
        const data = JSON.stringify(currentConversation, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `aether_chat_${Date.now()}.json`; a.click();
        URL.revokeObjectURL(url); showToast('Chat exported');
    }

    chatArea.addEventListener('click', (e) => {
        const btn = e.target.closest('.copy-msg-btn'); if (!btn) return;
        const wrapper = btn.closest('.message-wrapper');
        const content = wrapper?.getAttribute('data-content') || '';
        navigator.clipboard.writeText(content).then(() => showToast('Copied', 1500)).catch(() => showToast('Copy failed', 1500));
    });

    function closeAllDropdowns() { dropdownMenu.classList.add('hidden'); mobileDropdownMenu.classList.add('hidden'); }
    desktopMenuBtn.addEventListener('click', (e) => { e.stopPropagation(); dropdownMenu.classList.toggle('hidden'); mobileDropdownMenu.classList.add('hidden'); });
    mobileMenuBtn.addEventListener('click', (e) => { e.stopPropagation(); mobileDropdownMenu.classList.toggle('hidden'); dropdownMenu.classList.add('hidden'); });
    document.addEventListener('click', () => closeAllDropdowns());

    document.getElementById('dropdownClearChat').addEventListener('click', () => { closeAllDropdowns(); clearChat(); });
    document.getElementById('mobileDropdownClearChat').addEventListener('click', () => { closeAllDropdowns(); clearChat(); });
    document.getElementById('dropdownExportChat').addEventListener('click', () => { closeAllDropdowns(); exportChat(); });
    document.getElementById('mobileDropdownExportChat').addEventListener('click', () => { closeAllDropdowns(); exportChat(); });

    function updateLogos(dark) {
        welcomeLogo.src = dark ? 'logo-white.png' : 'logo-black.png';
        if (splashLogoImg) splashLogoImg.src = dark ? 'logo-white.png' : 'logo-black.png';
    }
    function setTheme(dark) {
        if (dark) {
            document.body.classList.add('dark'); themeLabel.textContent = 'Dark';
            themeIcon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
            localStorage.setItem('theme', 'dark'); updateLogos(true);
        } else {
            document.body.classList.remove('dark'); themeLabel.textContent = 'Light';
            themeIcon.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
            localStorage.setItem('theme', 'light'); updateLogos(false);
        }
    }
    const savedTheme = localStorage.getItem('theme');
    setTheme(savedTheme === 'dark');
    themeBtn.addEventListener('click', () => setTheme(!document.body.classList.contains('dark')));

    welcomeLogo.addEventListener('click', () => { welcomeLogo.classList.add('spin-logo'); });
    welcomeLogo.addEventListener('animationend', () => { welcomeLogo.classList.remove('spin-logo'); });

    desktopNewChatBtn.addEventListener('click', newChat);
    mobileNewChatBtn.addEventListener('click', () => { newChat(); if (window.innerWidth <= 768) { sidebar.classList.remove('open'); overlay.classList.remove('active'); } });

    document.getElementById('confirmClearCancel').addEventListener('click', () => confirmClearDialog.classList.add('hidden'));
    document.getElementById('confirmClearOk').addEventListener('click', () => { confirmClearDialog.classList.add('hidden'); performClearChat(); showToast('Chat cleared'); });

    btnSend.addEventListener('click', sendMessage);
    btnSendWelcome.addEventListener('click', sendMessage);

    function handleEnterKey(e, inputEl) {
        if (sendOnEnter && e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const sendBtn = activeInput === 'welcome' ? btnSendWelcome : btnSend;
            if (!sendBtn.disabled) sendMessage();
        }
    }
    welcomeUserInput.addEventListener('keydown', e => handleEnterKey(e, welcomeUserInput));
    userInput.addEventListener('keydown', e => handleEnterKey(e, userInput));

    welcomeUserInput.addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 120) + 'px'; });
    userInput.addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 120) + 'px'; });

    document.querySelectorAll('.suggested-prompt').forEach(btn => {
        btn.addEventListener('click', function () {
            const prompt = this.getAttribute('data-prompt');
            if (activeInput === 'welcome') welcomeUserInput.value = prompt; else userInput.value = prompt;
            sendMessage();
        });
    });

    searchInput.addEventListener('input', renderRecentChats);

    document.getElementById('sidebarExpandBtn').addEventListener('click', () => { sidebar.classList.add('open'); overlay.classList.add('active'); });
    overlay.addEventListener('click', () => { sidebar.classList.remove('open'); overlay.classList.remove('active'); });
    desktopSidebarToggle.addEventListener('click', () => document.body.classList.toggle('sidebar-collapsed'));

    document.getElementById('btnSettings').addEventListener('click', () => {
        sendOnEnterCheckbox.checked = sendOnEnter;
        customInstructionsInput.value = customInstructions;
        apiKeyInput.value = apiKey;
        settingsModalOverlay.classList.remove('hidden');
    });
    document.getElementById('btnSettingsClose').addEventListener('click', () => settingsModalOverlay.classList.add('hidden'));
    document.getElementById('btnSettingsSave').addEventListener('click', () => {
        sendOnEnter = sendOnEnterCheckbox.checked;
        saveCustomInstructions(customInstructionsInput.value.trim());
        apiKey = apiKeyInput.value.trim();
        localStorage.setItem('apiKey', apiKey);
        showToast('Settings saved');
        settingsModalOverlay.classList.add('hidden');
    });
    settingsModalOverlay.addEventListener('click', (e) => { if (e.target === settingsModalOverlay) settingsModalOverlay.classList.add('hidden'); });

    document.getElementById('btnMic').addEventListener('click', () => showToast('Voice input coming soon'));
    document.getElementById('btnMicWelcome').addEventListener('click', () => showToast('Voice input coming soon'));
    document.getElementById('btnAttachWelcome').addEventListener('click', () => showToast('File attachment coming soon'));
    document.getElementById('btnAttach').addEventListener('click', () => showToast('File attachment coming soon'));

    // ==================== SPLASH & INIT ====================
    function hideSplash() {
        splashOverlay.classList.add('hidden');
        setTimeout(() => { splashOverlay.style.display = 'none'; }, 500);
        app.classList.add('visible');
    }

    async function startApp() {
        console.log("App Init: Checking bridge...");
        try {
            showToast('Initializing Aether AI...');
            if (window.AndroidTFLite) console.log("AndroidTFLite detected early.");
            await waitForBridge();
            if (window.AndroidTFLite) {
                modelReady = true;
                console.log("Bridge initialized.");
                if (!apiKey) showToast('Local Qwen3 model ready');
                else showToast('API key set – using cloud model');
            } else {
                if (!apiKey) showToast('Running in browser – model not available. Set API key in Settings.');
                else showToast('API key set – using cloud model');
            }
        } catch (e) {
            console.error("Init error:", e);
            showToast('Init error: ' + e.message);
        }
        btnSend.disabled = false; btnSendWelcome.disabled = false;
        welcomeUserInput.focus();
    }

    if (splashLogoImg) {
        splashLogoImg.src = (savedTheme === 'dark') ? 'logo-white.png' : 'logo-black.png';
    }

    setTimeout(() => {
        hideSplash();
        startApp();
    }, 2500);

    setActiveInput('welcome');
})();