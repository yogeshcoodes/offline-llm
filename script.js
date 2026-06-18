(function () {
    console.log("Aethos AI script starting... (Multi-API support with fallback)");

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

    // ==================== MULTI-PROVIDER API CALL (with context) ====================
    async function callAIAPI(messages, apiKey, systemInstruction) {
        const key = apiKey.trim();
        if (!key) throw new Error("No API key provided");

        if (key.startsWith("gsk_")) {
            return await callGroqAPI(messages, key, systemInstruction);
        } else if (key.startsWith("sk-")) {
            return await callOpenAIAPI(messages, key, systemInstruction);
        } else if (key.startsWith("AIza") || key.length >= 30) {
            return await callGeminiAPI(messages, key, systemInstruction);
        } else {
            console.warn("Unknown API key format, trying Gemini...");
            return await callGeminiAPI(messages, key, systemInstruction);
        }
    }

    async function callGeminiAPI(messages, apiKey, systemInstruction) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
        const contents = [];
        for (const msg of messages) {
            const role = msg.role === 'user' ? 'user' : 'model';
            contents.push({ role: role, parts: [{ text: msg.content }] });
        }
        const requestBody = { contents: contents };
        if (systemInstruction) {
            requestBody.system_instruction = { parts: [{ text: systemInstruction }] };
        }
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

    const GROQ_MODELS = [
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
        "gemma2-9b-it",
        "qwen-2.5-32b"
    ];

    async function callGroqAPI(messages, apiKey, systemInstruction) {
        let fullMessages = [];
        if (systemInstruction) {
            fullMessages.push({ role: "system", content: systemInstruction });
        }
        fullMessages = fullMessages.concat(messages);
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
                        messages: fullMessages,
                        temperature: 0.7
                    })
                });
                if (!response.ok) {
                    const errText = await response.text();
                    const errorObj = JSON.parse(errText);
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
                if (err.message.includes("decommissioned") || err.message.includes("not found")) continue;
                throw err;
            }
        }
        throw new Error(`All Groq models failed. Last error: ${lastError?.message || "Unknown"}`);
    }

    async function callOpenAIAPI(messages, apiKey, systemInstruction) {
        const url = "https://api.openai.com/v1/chat/completions";
        let fullMessages = [];
        if (systemInstruction) {
            fullMessages.push({ role: "system", content: systemInstruction });
        }
        fullMessages = fullMessages.concat(messages);
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "gpt-3.5-turbo",
                messages: fullMessages,
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
    const main = document.getElementById('main');
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
    const scrollDownBtn = document.getElementById('scrollDownBtn');

    // ==================== STATE ====================
    let currentConversation = [];
    let typingIndicatorEl = null;
    let sendOnEnter = true;
    let activeInput = 'welcome';
    let currentAccent = localStorage.getItem('accent') || '#2A7CCC';
    let selectedAccent = currentAccent;
    let allConversations = [];
    let activeConversationId = null;
    let customInstructions = localStorage.getItem('customInstructions') || '';
    let apiKey = localStorage.getItem('apiKey') || '';

    let autoScroll = true;

    // Persistence helpers
    function persistData() {
        localStorage.setItem('allConversations', JSON.stringify(allConversations));
        localStorage.setItem('activeConversationId', activeConversationId || '');
    }

    function loadPersistedData() {
        const savedConv = localStorage.getItem('allConversations');
        if (savedConv) {
            try {
                allConversations = JSON.parse(savedConv);
            } catch (e) { allConversations = []; }
        }
        const savedActiveId = localStorage.getItem('activeConversationId');
        if (savedActiveId && allConversations.find(c => c.id === savedActiveId)) {
            activeConversationId = savedActiveId;
        }
        renderRecentChats();
    }

    function applyAccent(color) {
        currentAccent = color;
        document.body.style.setProperty('--primary', color);
        document.body.style.setProperty('--message-user-bg', color);
        localStorage.setItem('accent', color);
        accentCircles.forEach(c => c.classList.toggle('active', c.getAttribute('data-color') === color));
        selectedAccent = color;
    }
    applyAccent(currentAccent);

    accentCircles.forEach(c => {
        c.addEventListener('click', () => {
            selectedAccent = c.getAttribute('data-color');
            accentCircles.forEach(c2 => c2.classList.toggle('active', c2.getAttribute('data-color') === selectedAccent));
        });
    });

    customInstructionsInput.value = customInstructions;
    function saveCustomInstructions(val) { customInstructions = val; localStorage.setItem('customInstructions', val); }
    apiKeyInput.value = apiKey;

    function showToast(msg, duration = 2500) {
        toast.textContent = msg;
        toast.classList.add('visible');
        clearTimeout(toast._timeout);
        toast._timeout = setTimeout(() => {
            toast.classList.remove('visible');
        }, duration);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m])
            .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, c => c);
    }

    function simpleMarkdown(text) {
        if (!text) return '';
        let html = escapeHtml(text);
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        html = html.replace(/\n\n/g, '</p><p>');
        html = '<p>' + html.replace(/\n/g, '<br>') + '</p>';
        html = html.replace(/<p><\/p>/g, '');
        return html;
    }

    function updateScrollState() {
        const threshold = 50;
        const diff = chatArea.scrollHeight - chatArea.clientHeight - chatArea.scrollTop;
        if (diff < threshold) {
            autoScroll = true;
            if (scrollDownBtn) scrollDownBtn.classList.remove('visible');
        } else {
            autoScroll = false;
            if (scrollDownBtn) scrollDownBtn.classList.add('visible');
        }
    }

    chatArea.addEventListener('scroll', updateScrollState);
    chatArea.addEventListener('touchstart', () => { autoScroll = false; }, { passive: true });

    function scrollToBottom() {
        chatArea.scrollTop = chatArea.scrollHeight;
        autoScroll = true;
        if (scrollDownBtn) scrollDownBtn.classList.remove('visible');
    }

    if (scrollDownBtn) {
        scrollDownBtn.addEventListener('click', scrollToBottom);
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
        const formattedContent = role === 'ai' ? simpleMarkdown(content) : escapeHtml(content);
        wrapper.innerHTML = `
            <div class="message ${role === 'user' ? 'user-message' : 'ai-message'}">
                <div class="message-text">${formattedContent}</div>
                <div class="message-footer"><span class="message-time">${time}</span></div>
            </div>
            <div class="msg-actions">
                <button class="copy-msg-btn" title="Copy message">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                </button>
                <button class="speak-msg-btn" title="Read aloud">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-volume2-icon lucide-volume-2"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/></svg>
                </button>
            </div>
        `;
        chatArea.appendChild(wrapper);
        if (autoScroll) {
            scrollToBottom();
        } else {
            if (scrollDownBtn) scrollDownBtn.classList.add('visible');
        }
        currentConversation.push({ role, content, timestamp: Date.now() });

        if (role === 'user' && !activeConversationId && currentConversation.filter(m => m.role === 'user').length === 1) saveCurrentConversation(true);
        if (role === 'user' && activeConversationId && currentConversation.filter(m => m.role === 'user').length === 1) updateConversationTitle(activeConversationId, content);
        persistData();
    }

    function showTypingIndicator(show) {
        if (show && !typingIndicatorEl) {
            const div = document.createElement('div'); div.className = 'typing-indicator';
            div.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
            chatArea.appendChild(div); scrollToBottom(); typingIndicatorEl = div;
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
        persistData();
    }

    function updateConversationTitle(convId, content) {
        const conv = allConversations.find(c => c.id === convId);
        if (conv) { conv.title = generateChatTitle(content); conv.timestamp = Date.now(); renderRecentChats(); persistData(); }
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
            const formattedContent = msg.role === 'ai' ? simpleMarkdown(msg.content) : escapeHtml(msg.content);
            wrapper.innerHTML = `
                <div class="message ${msg.role === 'user' ? 'user-message' : 'ai-message'}">
                    <div class="message-text">${formattedContent}</div>
                    <div class="message-footer"><span class="message-time">${time}</span></div>
                </div>
                <div class="msg-actions">
                    <button class="copy-msg-btn" title="Copy message"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>
                    <button class="speak-msg-btn" title="Read aloud"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-volume2-icon lucide-volume-2"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/></svg></button>
                </div>
            `;
            chatArea.appendChild(wrapper);
        });
        welcomeScreen.style.display = 'none'; chatArea.style.display = 'flex';
        setActiveInput('chat'); scrollToBottom(); renderRecentChats();
        localStorage.setItem('activeConversationId', activeConversationId);
    }

    function deleteConversation(convId, e) {
        e.stopPropagation();
        allConversations = allConversations.filter(c => c.id !== convId);
        if (activeConversationId === convId) {
            activeConversationId = null; currentConversation = []; chatArea.innerHTML = ''; typingIndicatorEl = null;
            welcomeScreen.style.display = 'flex'; chatArea.style.display = 'none';
            welcomeUserInput.value = ''; userInput.value = ''; setActiveInput('welcome');
            localStorage.removeItem('activeConversationId');
        }
        renderRecentChats(); showToast('Chat deleted');
        persistData();
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
                if (window.innerWidth <= 768) { closeSidebar(); }
            });
            tile.querySelector('.chat-tile-delete').addEventListener('click', (e) => deleteConversation(conv.id, e));
            chatList.appendChild(tile);
        });
    }

    function buildLocalPrompt(newUserMessage) {
        const defaultSystem = 'You are Aethos AI, a helpful, concise assistant. Answer directly and never invent questions or unrelated text. Do not write "User:" or "Assistant:" in your response.';
        const systemPrompt = customInstructions.trim() || defaultSystem;

        let prompt = '<|begin_of_text|>';
        prompt += `<|start_header_id|>system<|end_header_id|>\n${systemPrompt}<|eot_id|>`;

        for (const msg of currentConversation) {
            if (msg.role === 'user') {
                prompt += `<|start_header_id|>user<|end_header_id|>\n${msg.content}<|eot_id|>`;
            } else if (msg.role === 'ai') {
                prompt += `<|start_header_id|>assistant<|end_header_id|>\n${msg.content}<|eot_id|>`;
            }
        }

        prompt += `<|start_header_id|>user<|end_header_id|>\n${newUserMessage}<|eot_id|>`;
        prompt += `<|start_header_id|>assistant<|end_header_id|>\n`;
        return prompt;
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
        appendMessage('user', text);
        autoScroll = true;
        showTypingIndicator(true);
        sendBtn.disabled = true;

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
                const messages = currentConversation.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content }));
                const systemInstruction = customInstructions.trim() || null;
                try {
                    response = await callAIAPI(messages, apiKey, systemInstruction);
                } catch (apiErr) {
                    console.warn('Cloud API error:', apiErr);
                    if (modelReady && window.AndroidTFLite) {
                        showToast('API error, trying local model...');
                        response = await new Promise((resolve, reject) => {
                            askLocalLLM(buildLocalPrompt(text), resolve, reject);
                        });
                    } else {
                        throw new Error(`API call failed: ${apiErr.message}`);
                    }
                }
            } else {
                if (!modelReady || !window.AndroidTFLite) throw new Error('Local model not ready');
                response = await new Promise((resolve, reject) => {
                    askLocalLLM(buildLocalPrompt(text), resolve, reject);
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
            saveCurrentConversation(false);
            renderRecentChats();
            if (activeInput === 'welcome') welcomeUserInput.focus(); else userInput.focus();
        }
    }

    function newChat() {
        if (currentConversation.length > 0) saveCurrentConversation(false);
        activeConversationId = null; currentConversation = []; chatArea.innerHTML = ''; typingIndicatorEl = null;
        welcomeScreen.style.display = 'flex'; chatArea.style.display = 'none';
        welcomeUserInput.value = ''; userInput.value = ''; setActiveInput('welcome');
        renderRecentChats();
        localStorage.removeItem('activeConversationId');
        if (window.AndroidTFLite && typeof window.AndroidTFLite.resetChat === 'function') window.AndroidTFLite.resetChat();
    }

    function clearChat() { confirmClearDialog.classList.remove('hidden'); }
    function performClearChat() {
        if (activeConversationId) allConversations = allConversations.filter(c => c.id !== activeConversationId);
        activeConversationId = null; currentConversation = []; chatArea.innerHTML = ''; typingIndicatorEl = null;
        welcomeScreen.style.display = 'flex'; chatArea.style.display = 'none';
        welcomeUserInput.value = ''; userInput.value = ''; setActiveInput('welcome');
        renderRecentChats();
        persistData();
        if (window.AndroidTFLite && typeof window.AndroidTFLite.resetChat === 'function') window.AndroidTFLite.resetChat();
    }

    function exportChat() {
        if (currentConversation.length === 0) { showToast('Nothing to export'); return; }
        const data = JSON.stringify(currentConversation, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `aethos_chat_${Date.now()}.json`; a.click();
        URL.revokeObjectURL(url); showToast('Chat exported');
    }

    // Copy & Speak – only refocus if keyboard was already open
    chatArea.addEventListener('click', (e) => {
        const copyBtn = e.target.closest('.copy-msg-btn');
        const speakBtn = e.target.closest('.speak-msg-btn');
        if (copyBtn) {
            const wrapper = copyBtn.closest('.message-wrapper');
            const content = wrapper?.getAttribute('data-content') || '';
            navigator.clipboard.writeText(content).then(() => showToast('Copied', 1500)).catch(() => showToast('Copy failed', 1500));
        }
        if (speakBtn) {
            const wrapper = speakBtn.closest('.message-wrapper');
            const content = wrapper?.getAttribute('data-content') || '';
            if (window.PiperTTS && typeof window.PiperTTS.speak === 'function') {
                window.PiperTTS.speak(content);
            } else if (window.speechSynthesis) {
                window.speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(content);
                utterance.onstart = () => speakBtn.classList.add('speaking');
                utterance.onend = () => speakBtn.classList.remove('speaking');
                utterance.onerror = () => speakBtn.classList.remove('speaking');
                window.speechSynthesis.speak(utterance);
            } else {
                showToast('Speech synthesis not supported');
            }
        }
        const activeInputEl = activeInput === 'welcome' ? welcomeUserInput : userInput;
        if (activeInputEl && (document.activeElement === welcomeUserInput || document.activeElement === userInput)) {
            setTimeout(() => {
                activeInputEl.focus();
                activeInputEl.setSelectionRange(activeInputEl.value.length, activeInputEl.value.length);
            }, 100);
        }
    });

    function closeAllDropdowns() { dropdownMenu.classList.add('hidden'); mobileDropdownMenu.classList.add('hidden'); }
    desktopMenuBtn.addEventListener('click', (e) => { e.stopPropagation(); dropdownMenu.classList.toggle('hidden'); mobileDropdownMenu.classList.add('hidden'); });
    mobileMenuBtn.addEventListener('click', (e) => { e.stopPropagation(); mobileDropdownMenu.classList.toggle('hidden'); dropdownMenu.classList.add('hidden'); });
    document.addEventListener('click', () => closeAllDropdowns());

    document.getElementById('dropdownClearChat').addEventListener('click', () => { closeAllDropdowns(); clearChat(); });
    document.getElementById('mobileDropdownClearChat').addEventListener('click', () => { closeAllDropdowns(); clearChat(); });
    document.getElementById('dropdownExportChat').addEventListener('click', () => { closeAllDropdowns(); exportChat(); });
    document.getElementById('mobileDropdownExportChat').addEventListener('click', () => { closeAllDropdowns(); exportChat(); });

    // Theme
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
    mobileNewChatBtn.addEventListener('click', () => { newChat(); if (window.innerWidth <= 768) { closeSidebar(); } });

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

    // ==================== SIDEBAR FIXED ====================
    function openSidebar() {
        sidebar.classList.add('open');
        overlay.classList.add('active');
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    }

    // Toggle button – now toggles correctly
    document.getElementById('sidebarExpandBtn').addEventListener('click', () => {
        if (sidebar.classList.contains('open')) {
            closeSidebar();
        } else {
            openSidebar();
        }
    });

    overlay.addEventListener('click', closeSidebar);
    desktopSidebarToggle.addEventListener('click', () => document.body.classList.toggle('sidebar-collapsed'));

    // Swipe gesture on main area (except messages) to open/close sidebar
    let gestureStartX = 0, gestureStartY = 0, gestureActive = false;

    main.addEventListener('touchstart', (e) => {
        // Exclude touches on message wrappers and the chat area itself to avoid interfering with scroll/selection
        if (e.target.closest('#chatArea') || e.target.closest('.message-wrapper')) return;
        const touch = e.touches[0];
        gestureStartX = touch.clientX;
        gestureStartY = touch.clientY;
        gestureActive = true;
    }, { passive: false });

    main.addEventListener('touchmove', (e) => {
        if (!gestureActive) return;
        const touch = e.touches[0];
        const dx = touch.clientX - gestureStartX;
        const dy = touch.clientY - gestureStartY;

        // If vertical movement is larger, let the scroll happen normally
        if (Math.abs(dy) > Math.abs(dx)) {
            gestureActive = false;
            return;
        }

        // Right swipe (open sidebar if not already open)
        if (dx > 50 && !sidebar.classList.contains('open')) {
            e.preventDefault();
            openSidebar();
            gestureActive = false;
        }
        // Left swipe (close sidebar if open)
        if (dx < -50 && sidebar.classList.contains('open')) {
            e.preventDefault();
            closeSidebar();
            gestureActive = false;
        }
    }, { passive: false });

    main.addEventListener('touchend', () => {
        gestureActive = false;
    });

    // ==================== SETTINGS ====================
    document.getElementById('btnSettings').addEventListener('click', () => {
        sendOnEnterCheckbox.checked = sendOnEnter;
        customInstructionsInput.value = customInstructions;
        apiKeyInput.value = apiKey;
        selectedAccent = currentAccent;
        accentCircles.forEach(c => c.classList.toggle('active', c.getAttribute('data-color') === selectedAccent));
        settingsModalOverlay.classList.remove('hidden');
    });
    document.getElementById('btnSettingsClose').addEventListener('click', () => settingsModalOverlay.classList.add('hidden'));
    document.getElementById('btnSettingsSave').addEventListener('click', () => {
        sendOnEnter = sendOnEnterCheckbox.checked;
        saveCustomInstructions(customInstructionsInput.value.trim());
        apiKey = apiKeyInput.value.trim();
        localStorage.setItem('apiKey', apiKey);
        if (selectedAccent !== currentAccent) {
            applyAccent(selectedAccent);
        }
        showToast('Settings saved');
        settingsModalOverlay.classList.add('hidden');
    });
    settingsModalOverlay.addEventListener('click', (e) => { if (e.target === settingsModalOverlay) settingsModalOverlay.classList.add('hidden'); });

    // ==================== USER ACCOUNT ====================
    const userAccountModal = document.getElementById('userAccountModal');
    const btnUserAccount = document.getElementById('btnUserAccount');
    const btnUserAccountClose = document.getElementById('btnUserAccountClose');
    const userOptionBtns = document.querySelectorAll('.user-option-btn');

    btnUserAccount.addEventListener('click', () => { userAccountModal.classList.remove('hidden'); });
    btnUserAccountClose.addEventListener('click', () => { userAccountModal.classList.add('hidden'); });
    userAccountModal.addEventListener('click', (e) => { if (e.target === userAccountModal) userAccountModal.classList.add('hidden'); });

    userOptionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const provider = btn.getAttribute('data-provider');
            showToast(`${provider === 'google' ? 'Google' : provider === 'facebook' ? 'Facebook' : 'Phone'} login coming soon!`);
            userAccountModal.classList.add('hidden');
        });
    });

    // ==================== ATTACH POPUP ====================
    function createAttachPopup(attachBtn) {
        if (attachBtn._attachPopup) return attachBtn._attachPopup;
        const popup = document.createElement('div');
        popup.className = 'attach-popup hidden';

        const cameraBtn = document.createElement('button');
        cameraBtn.className = 'attach-option';
        cameraBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-camera-icon lucide-camera"><path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/></svg> Camera`;
        const photosBtn = document.createElement('button');
        photosBtn.className = 'attach-option';
        photosBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-image-icon lucide-image"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg> Photos`;
        const filesBtn = document.createElement('button');
        filesBtn.className = 'attach-option';
        filesBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-icon lucide-file"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/></svg> Files`;

        popup.appendChild(cameraBtn);
        popup.appendChild(photosBtn);
        popup.appendChild(filesBtn);

        const inputContainer = attachBtn.closest('.input-container');
        if (inputContainer) {
            inputContainer.appendChild(popup);
        } else {
            document.body.appendChild(popup);
        }

        attachBtn._attachPopup = popup;

        const handleFileInput = (input) => {
            input.addEventListener('change', (e) => {
                const files = e.target.files;
                if (!files || files.length === 0) return;
                const fileNames = Array.from(files).map(f => f.name).join(', ');
                const typeHint = input.getAttribute('data-type') || 'file';
                appendMessage('user', `📎 Attached ${typeHint}: ${fileNames}`);
                saveCurrentConversation(false);
                renderRecentChats();
            });
            input.click();
        };

        cameraBtn.addEventListener('click', () => {
            popup.classList.add('hidden');
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
            input.setAttribute('data-type', 'photo'); input.style.display = 'none';
            document.body.appendChild(input);
            handleFileInput(input);
        });
        photosBtn.addEventListener('click', () => {
            popup.classList.add('hidden');
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'image/*';
            input.setAttribute('data-type', 'photo'); input.style.display = 'none';
            document.body.appendChild(input);
            handleFileInput(input);
        });
        filesBtn.addEventListener('click', () => {
            popup.classList.add('hidden');
            const input = document.createElement('input');
            input.type = 'file'; input.accept = '*/*'; input.multiple = true;
            input.setAttribute('data-type', 'file'); input.style.display = 'none';
            document.body.appendChild(input);
            handleFileInput(input);
        });

        return popup;
    }

    function toggleAttachPopup(attachBtn) {
        const popup = createAttachPopup(attachBtn);
        document.querySelectorAll('.attach-popup').forEach(p => { if (p !== popup) p.classList.add('hidden'); });
        popup.classList.toggle('hidden');
    }

    document.getElementById('btnAttach').addEventListener('click', (e) => { e.stopPropagation(); toggleAttachPopup(document.getElementById('btnAttach')); });
    document.getElementById('btnAttachWelcome').addEventListener('click', (e) => { e.stopPropagation(); toggleAttachPopup(document.getElementById('btnAttachWelcome')); });
    document.addEventListener('click', (e) => { if (!e.target.closest('.attach-popup') && !e.target.closest('.icon-btn')) { document.querySelectorAll('.attach-popup').forEach(p => p.classList.add('hidden')); } });

    // ==================== MIC ====================
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let isListening = false;

    async function requestMicPermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            return true;
        } catch (err) { console.warn('Microphone permission denied:', err); return false; }
    }

    function initSpeechRecognition() {
        if (!SpeechRecognition) { showToast('Voice input not supported'); return null; }
        const rec = new SpeechRecognition();
        rec.continuous = false; rec.interimResults = true; rec.lang = 'en-US';
        return rec;
    }

    async function startListening(micBtn) {
        if (isListening) { stopListening(); return; }
        const hasPermission = await requestMicPermission();
        if (!hasPermission) { showToast('Microphone permission denied.'); return; }
        if (!recognition) recognition = initSpeechRecognition();
        if (!recognition) return;
        isListening = true;
        micBtn.classList.add('mic-active');
        showToast('Listening...');

        recognition.onresult = (event) => {
            let finalTranscript = '', interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                if (result.isFinal) finalTranscript += result[0].transcript;
                else interimTranscript += result[0].transcript;
            }
            const activeEl = activeInput === 'welcome' ? welcomeUserInput : userInput;
            if (finalTranscript) activeEl.value = finalTranscript;
            else if (interimTranscript) activeEl.value = interimTranscript;
            activeEl.dispatchEvent(new Event('input'));
        };
        recognition.onerror = (event) => {
            console.error('Speech error:', event.error);
            showToast('Voice error: ' + event.error);
            stopListening();
        };
        recognition.onend = () => { stopListening(); };
        try { recognition.start(); } catch (err) { stopListening(); showToast('Could not start voice recognition.'); }
    }

    function stopListening() {
        if (recognition && isListening) {
            isListening = false;
            try { recognition.stop(); } catch (e) { }
        }
        document.querySelectorAll('.icon-btn.mic-active').forEach(btn => btn.classList.remove('mic-active'));
    }

    document.getElementById('btnMic').addEventListener('click', () => startListening(document.getElementById('btnMic')));
    document.getElementById('btnMicWelcome').addEventListener('click', () => startListening(document.getElementById('btnMicWelcome')));

    // Clear cache
    const settingsModal = document.querySelector('#settingsModalOverlay .modal');
    if (settingsModal) {
        const clearCacheBtn = document.createElement('button');
        clearCacheBtn.className = 'btn-secondary';
        clearCacheBtn.textContent = 'Clear Cache';
        clearCacheBtn.style.marginTop = '16px'; clearCacheBtn.style.width = '100%';
        clearCacheBtn.addEventListener('click', () => {
            const confirmTitle = document.getElementById('confirmDialogTitle');
            const confirmMsg = document.getElementById('confirmDialogMessage');
            const origTitle = confirmTitle.textContent;
            const origMsg = confirmMsg.textContent;
            confirmTitle.textContent = 'Clear all app data?';
            confirmMsg.textContent = 'This will remove chat history and reset preferences. Your API key will be kept.';
            confirmClearDialog.classList.remove('hidden');

            const onCancel = () => {
                confirmTitle.textContent = origTitle; confirmMsg.textContent = origMsg;
                confirmClearDialog.classList.add('hidden');
                document.getElementById('confirmClearCancel').removeEventListener('click', onCancel);
                document.getElementById('confirmClearOk').removeEventListener('click', onConfirm);
            };
            const onConfirm = () => {
                const keepKeys = ['theme', 'accent', 'apiKey'];
                Object.keys(localStorage).forEach(key => { if (!keepKeys.includes(key)) localStorage.removeItem(key); });
                allConversations = []; activeConversationId = null; currentConversation = [];
                customInstructions = ''; customInstructionsInput.value = '';
                apiKeyInput.value = localStorage.getItem('apiKey') || ''; apiKey = localStorage.getItem('apiKey') || '';
                chatArea.innerHTML = ''; typingIndicatorEl = null;
                welcomeScreen.style.display = 'flex'; chatArea.style.display = 'none';
                welcomeUserInput.value = ''; userInput.value = '';
                setActiveInput('welcome'); renderRecentChats();
                persistData();
                confirmTitle.textContent = origTitle; confirmMsg.textContent = origMsg;
                confirmClearDialog.classList.add('hidden');
                showToast('Cache cleared');
                document.getElementById('confirmClearCancel').removeEventListener('click', onCancel);
                document.getElementById('confirmClearOk').removeEventListener('click', onConfirm);
            };
            document.getElementById('confirmClearCancel').addEventListener('click', onCancel);
            document.getElementById('confirmClearOk').addEventListener('click', onConfirm);
        });
        const modalButtons = settingsModal.querySelector('.modal-buttons');
        if (modalButtons) { modalButtons.parentNode.insertBefore(clearCacheBtn, modalButtons); }
        else { settingsModal.appendChild(clearCacheBtn); }
    }

    // Input focus scroll
    function scrollInputIntoView(e) {
        setTimeout(() => {
            const wrapper = e.target.closest('.input-container-wrapper') || e.target.closest('.welcome-input-container');
            if (wrapper) wrapper.scrollIntoView({ block: 'end', behavior: 'smooth' });
        }, 300);
    }
    welcomeUserInput.addEventListener('focus', scrollInputIntoView);
    userInput.addEventListener('focus', scrollInputIntoView);

    // Splash & init
    function hideSplash() {
        splashOverlay.classList.add('hidden');
        setTimeout(() => { splashOverlay.style.display = 'none'; }, 500);
        app.classList.add('visible');
    }
    async function startApp() {
        console.log("App Init: Checking bridge...");
        loadPersistedData();
        if (activeConversationId) {
            const conv = allConversations.find(c => c.id === activeConversationId);
            if (conv) {
                loadConversation(activeConversationId);
            }
        }
        try {
            showToast('Initializing Aethos AI...');
            if (window.AndroidTFLite) console.log("AndroidTFLite detected early.");
            await waitForBridge();
            if (window.AndroidTFLite) {
                modelReady = true;
                showToast(apiKey ? 'API key set – using cloud model' : 'Local model ready');
            } else {
                showToast(apiKey ? 'API key set – using cloud model' : 'Running in browser – set API key in Settings.');
            }
        } catch (e) {
            console.error("Init error:", e);
            showToast('Init error: ' + e.message);
        }
        btnSend.disabled = false; btnSendWelcome.disabled = false;
        if (!activeConversationId) {
            welcomeUserInput.focus();
        }
    }

    if (splashLogoImg) splashLogoImg.src = (savedTheme === 'dark') ? 'logo-white.png' : 'logo-black.png';

    setTimeout(() => { hideSplash(); startApp(); }, 2500);
    setActiveInput('welcome');
})();