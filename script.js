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
    async function callAIAPI(messages, apiKey, systemInstruction, signal) {
        const key = apiKey.trim();
        if (!key) throw new Error("No API key provided");

        if (key.startsWith("gsk_")) {
            return await callGroqAPI(messages, key, systemInstruction, signal);
        } else if (key.startsWith("sk-")) {
            return await callOpenAIAPI(messages, key, systemInstruction, signal);
        } else if (key.startsWith("AIza") || key.length >= 30) {
            return await callGeminiAPI(messages, key, systemInstruction, signal);
        } else {
            console.warn("Unknown API key format, trying Gemini...");
            return await callGeminiAPI(messages, key, systemInstruction, signal);
        }
    }

    async function callGeminiAPI(messages, apiKey, systemInstruction, signal) {
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
            body: JSON.stringify(requestBody),
            signal: signal
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

    async function callGroqAPI(messages, apiKey, systemInstruction, signal) {
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
                    }),
                    signal: signal
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
                if (err.name === 'AbortError') throw err; // Don't continue if aborted
                if (err.message.includes("decommissioned") || err.message.includes("not found")) continue;
                throw err;
            }
        }
        throw new Error(`All Groq models failed. Last error: ${lastError?.message || "Unknown"}`);
    }

    async function callOpenAIAPI(messages, apiKey, systemInstruction, signal) {
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
            }),
            signal: signal
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
    const scrollDownBtn = document.getElementById('scrollDownBtn');

    // Web Search Toggle Refs
    const btnSearchWelcome = document.getElementById('btnSearchWelcome');
    const btnSearchMain = document.getElementById('btnSearchMain');

    // Audio Player Refs
    const audioPlayer = document.getElementById('audioPlayer');
    const audioPlayPauseBtn = document.getElementById('audioPlayPauseBtn');
    const audioCloseBtn = document.getElementById('audioCloseBtn');
    const audioProgressFill = document.getElementById('audioProgressFill');
    const audioIconPlay = document.getElementById('audioIconPlay');
    const audioIconPause = document.getElementById('audioIconPause');
    let currentUtterance = null;

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
    let pendingAttachments = [];
    let isWebSearchEnabled = false;

    // Centralized Confirmation State
    let pendingConfirmAction = null;

    // Abort Logic & Streaming
    let globalAbortController = null;
    let isGenerating = false;
    let typingInterval = null;

    // Auto-scroll state
    let autoScroll = true;

    // ==================== MASTER AI SYSTEM PROMPT ====================
    // Heavily upgraded behavior control to prevent hallucinations, image generation loops, and improve local model logic.
    const MASTER_SYSTEM_PROMPT = `You are Aethos AI, an advanced, highly intelligent assistant.
CRITICAL CAPABILITIES & RULES:
1. IMAGE GENERATION: The system has a built-in image generator. If the user asks you to create, generate, or draw an image, YOU MUST reply EXACTLY with: "I can do that! Please start your next prompt with 'Generate an image of...' so my visual engine can process it." DO NOT attempt to describe the image yourself. DO NOT ask "Would you like me to generate it now?". YOU MUST NEVER pretend you are drawing it.
2. WEB SEARCH: You have real-time internet access via integrated tools. If the user asks about current events, answer factually using the provided Web Search Context. 
3. NEVER say "As a text-based AI, I cannot..." or "I don't have internet access." You possess these capabilities.
4. REASONING: Think step-by-step for complex queries. Be concise but highly accurate. Break down complex tasks logically.
5. FORMATTING: Use Markdown for all formatting (bolding, lists, code blocks). Do not prefix your replies with "Aethos:" or "Assistant:".`;

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

    // Apply accent
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

    // Toast with fade
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

    // Advanced Markdown parser ensuring code blocks don't get destroyed by <br> conversions
    window.copyCodeBlock = function (btn) {
        const pre = btn.closest('.code-block-wrapper').querySelector('pre');
        const code = pre.textContent; // Pulls text cleanly without html tags
        navigator.clipboard.writeText(code).then(() => {
            const originalHtml = btn.innerHTML;
            btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
            setTimeout(() => {
                btn.innerHTML = originalHtml;
            }, 2000);
        });
    };

    function simpleMarkdown(text) {
        if (!text) return '';
        let html = escapeHtml(text);

        // Render Images ![alt](url)
        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%; border-radius:12px; margin-top:8px; display:block;">');

        // 1. Extract Code Blocks so we don't mess up their formatting with <p> and <br>
        const codeBlocks = [];
        html = html.replace(/```(\w*)[ \t]*\r?\n([\s\S]*?)```/g, function (match, lang, code) {
            codeBlocks.push({ lang, code });
            return `\n\n___CODE_BLOCK_${codeBlocks.length - 1}___\n\n`;
        });

        // 2. Formatting inline text
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

        // 3. Process lines and paragraphs
        html = html.split(/\n\n+/).map(p => {
            const trimmed = p.trim();
            if (!trimmed) return '';
            if (trimmed.startsWith('___CODE_BLOCK_')) return trimmed; // Ignore code placeholders
            if (trimmed.startsWith('<img')) return trimmed; // Ignore image wrappers
            return '<p>' + trimmed.replace(/\n/g, '<br>') + '</p>';
        }).join('');

        // 4. Re-inject formatted Code Blocks
        codeBlocks.forEach((block, index) => {
            const languageClass = block.lang ? `language-${block.lang.toLowerCase()}` : 'language-plaintext';
            const langLabel = block.lang ? block.lang.toUpperCase() : 'CODE';
            const blockHtml = `
                <div class="code-block-wrapper">
                    <div class="code-block-header">
                        <span class="code-block-lang">${langLabel}</span>
                        <button class="code-block-copy-btn" onclick="copyCodeBlock(this)">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                            Copy
                        </button>
                    </div>
                    <pre><code class="${languageClass}">${block.code}</code></pre>
                </div>
            `;
            html = html.replace(`___CODE_BLOCK_${index}___`, blockHtml);
        });

        return html;
    }

    // Image download utility
    async function downloadImage(url, filename) {
        try {
            showToast('Downloading image...');
            const response = await fetch(url);
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(objectUrl);
        } catch (e) {
            showToast('Download failed, opening in new tab.');
            window.open(url, '_blank');
        }
    }

    // ─── Attachments Rendering ───
    function renderAttachments() {
        const previewWelcome = document.getElementById('attachmentPreviewWelcome');
        const previewMain = document.getElementById('attachmentPreviewMain');

        const renderTo = (container) => {
            if (!container) return;
            container.innerHTML = '';
            if (pendingAttachments.length === 0) {
                container.classList.add('hidden');
                return;
            }
            container.classList.remove('hidden');
            pendingAttachments.forEach((fileObj, idx) => {
                const div = document.createElement('div');
                div.className = 'attachment-item';
                if (fileObj.type.startsWith('image/')) {
                    div.innerHTML = `<img src="${fileObj.url}" alt="attachment"><button data-idx="${idx}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>`;
                } else {
                    div.innerHTML = `<div style="width:100%; height:100%; background:var(--primary-light); display:flex; align-items:center; justify-content:center;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><button data-idx="${idx}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>`;
                }
                container.appendChild(div);
            });

            container.querySelectorAll('button').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = parseInt(e.currentTarget.getAttribute('data-idx'));
                    pendingAttachments.splice(idx, 1);
                    renderAttachments();
                    toggleSendButtonState();
                });
            });
        };

        renderTo(previewWelcome);
        renderTo(previewMain);
    }

    // ─── Web Search Toggle Logic ───
    function toggleWebSearch() {
        if (!navigator.onLine) {
            showToast('Internet connection required for Web Search');
            return;
        }
        isWebSearchEnabled = !isWebSearchEnabled;
        btnSearchWelcome.classList.toggle('active', isWebSearchEnabled);
        btnSearchMain.classList.toggle('active', isWebSearchEnabled);
        showToast(isWebSearchEnabled ? 'Web Search Enabled' : 'Web Search Disabled');
    }
    btnSearchWelcome.addEventListener('click', toggleWebSearch);
    btnSearchMain.addEventListener('click', toggleWebSearch);

    // ─── Auto-scroll control ───
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

    chatArea.addEventListener('touchstart', () => {
        autoScroll = false;
    }, { passive: true });

    function scrollToBottom() {
        chatArea.scrollTop = chatArea.scrollHeight;
        autoScroll = true;
        if (scrollDownBtn) scrollDownBtn.classList.remove('visible');
    }

    if (scrollDownBtn) {
        scrollDownBtn.addEventListener('click', scrollToBottom);
    }

    // ─── Audio Cleanup / Stop TTS ───
    function stopTTS() {
        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
        if (window.PiperTTS && typeof window.PiperTTS.stop === 'function') {
            window.PiperTTS.stop();
        }
        audioPlayer.classList.add('hidden');
        audioProgressFill.style.width = '0%';
        document.querySelectorAll('.speaking').forEach(el => el.classList.remove('speaking'));
        if (currentUtterance && currentUtterance._progressInterval) {
            clearInterval(currentUtterance._progressInterval);
            clearTimeout(currentUtterance._progressInterval);
        }
        currentUtterance = null;
    }

    // ─── Simulated Streaming Effect (Cursor line completely removed) ───
    function simulateTyping(element, text, role, onComplete) {
        let index = 0;
        element.innerHTML = '';

        // Ensure intervals are cleared if multiple calls happen
        if (typingInterval) clearInterval(typingInterval);

        typingInterval = setInterval(() => {
            index += 4; // Reveal 4 characters per tick for smooth but fast typing
            if (index >= text.length) {
                index = text.length;
                clearInterval(typingInterval);
                element.innerHTML = role === 'ai' ? simpleMarkdown(text) : escapeHtml(text);
                if (window.Prism) Prism.highlightAllUnder(element.closest('.message-wrapper'));
                if (onComplete) onComplete();
            } else {
                let currentText = text.substring(0, index);
                element.innerHTML = role === 'ai' ? simpleMarkdown(currentText) : escapeHtml(currentText);
            }
            if (autoScroll) scrollToBottom();
        }, 15);
    }

    // ─── Message rendering (Updated for Image Hide Logic) ───
    function appendMessage(role, content, attachments = [], animate = false, isImage = false, generatedImgUrl = '') {
        if (welcomeScreen.style.display !== 'none') {
            welcomeScreen.style.display = 'none';
            chatArea.style.display = 'flex';
            setActiveInput('chat');
        }
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${role === 'user' ? 'user' : 'ai'}`;
        wrapper.setAttribute('data-content', content);

        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        let attachmentHtml = '';
        if (attachments && attachments.length > 0) {
            attachmentHtml = '<div class="chat-message-attachments">';
            attachments.forEach(att => {
                if (att.type.startsWith('image/')) {
                    attachmentHtml += `<img src="${att.url}" alt="attached image" style="max-width: 240px; max-height: 240px; width: auto; height: auto; object-fit: contain; border-radius: 12px; margin-top: 4px;">`;
                } else {
                    attachmentHtml += `<div style="background:rgba(0,0,0,0.15); padding:8px 12px; border-radius:8px; display:inline-flex; align-items:center; gap:8px; font-size:0.85rem;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> ${att.name}</div>`;
                }
            });
            attachmentHtml += '</div>';
        }

        // Action Buttons Setup (Download if image, standard buttons otherwise)
        let actionButtonsHtml = '';
        if (isImage) {
            actionButtonsHtml = `
                <button class="download-img-btn" data-url="${generatedImgUrl}" title="Download Image">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-download-icon lucide-download"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg>
                </button>
            `;
        } else if (role === 'user') {
            actionButtonsHtml = `
                <button class="edit-msg-btn" title="Edit message">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pencil"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>
                </button>
                <button class="copy-msg-btn" title="Copy message">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                </button>
                <button class="speak-msg-btn" title="Read aloud">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/></svg>
                </button>
            `;
        } else {
            actionButtonsHtml = `
                <button class="copy-msg-btn" title="Copy message">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                </button>
                <button class="speak-msg-btn" title="Read aloud">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/></svg>
                </button>
            `;
        }

        wrapper.innerHTML = `
            <div class="message ${role === 'user' ? 'user-message' : 'ai-message'}">
                ${attachmentHtml}
                <div class="message-text"></div>
                <div class="message-footer"><span class="message-time">${time}</span></div>
            </div>
            <div class="msg-actions">
                ${actionButtonsHtml}
            </div>
        `;
        chatArea.appendChild(wrapper);

        const textEl = wrapper.querySelector('.message-text');

        if (animate) {
            simulateTyping(textEl, content, role, () => {
                // Formatting done inside simulateTyping
            });
        } else {
            textEl.innerHTML = role === 'ai' ? simpleMarkdown(content) : escapeHtml(content);
            if (window.Prism) Prism.highlightAllUnder(wrapper);
        }

        if (autoScroll) {
            scrollToBottom();
        } else {
            if (scrollDownBtn) scrollDownBtn.classList.add('visible');
        }

        currentConversation.push({ role, content, attachments, timestamp: Date.now() });

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
        stopTTS();
        if (activeConversationId && currentConversation.length > 0) saveCurrentConversation(false);
        const conv = allConversations.find(c => c.id === convId);
        if (!conv) return;
        activeConversationId = convId; currentConversation = [...conv.messages];
        chatArea.innerHTML = ''; typingIndicatorEl = null;

        // Re-render historical messages without animation
        currentConversation.forEach(msg => {
            // Check if it's an image from history
            let isImage = false;
            let imgUrl = '';
            if (msg.role === 'ai' && msg.content.includes('Here is your image:') && msg.content.includes('![')) {
                isImage = true;
                const match = msg.content.match(/\((https:\/\/image\.pollinations\.ai[^)]+)\)/);
                if (match) imgUrl = match[1];
            }

            appendMessage(msg.role, msg.content, msg.attachments, false, isImage, imgUrl);
            // Quick cleanup of duplicate push from appendMessage
            currentConversation.pop();
        });

        welcomeScreen.style.display = 'none'; chatArea.style.display = 'flex';
        setActiveInput('chat'); scrollToBottom(); renderRecentChats();
        localStorage.setItem('activeConversationId', activeConversationId);
    }

    function deleteConversation(convId, e) {
        e.stopPropagation();
        stopTTS();
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
        const systemPrompt = customInstructions.trim() ? (MASTER_SYSTEM_PROMPT + "\n\nUser Custom Instructions:\n" + customInstructions.trim()) : MASTER_SYSTEM_PROMPT;

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

    function toggleSendStop(generating) {
        isGenerating = generating;
        const svgs = document.querySelectorAll('#btnSend svg, #btnSendWelcome svg');
        svgs.forEach(svg => {
            if (generating) {
                // Stop Square Icon
                svg.innerHTML = `<rect x="6" y="6" width="12" height="12" rx="2" ry="2" fill="currentColor" stroke="currentColor" stroke-width="2"/>`;
            } else {
                // Send Icon
                svg.innerHTML = `<path d="m5 12 7-7 7 7" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 19V5" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
            }
        });

        // Ensure buttons stay enabled during generation so we can click STOP
        document.getElementById('btnSend').disabled = false;
        document.getElementById('btnSendWelcome').disabled = false;
    }

    function toggleSendButtonState() {
        const inputEl = activeInput === 'welcome' ? welcomeUserInput : userInput;
        const sendBtn = activeInput === 'welcome' ? btnSendWelcome : btnSend;
        const hasText = inputEl.value.trim().length > 0;
        const hasAttachments = pendingAttachments.length > 0;

        if (!isGenerating) {
            sendBtn.disabled = !(hasText || hasAttachments);
        }
    }

    async function sendMessage() {
        if (isGenerating) {
            // STOP Logic
            if (globalAbortController) globalAbortController.abort();
            if (typingInterval) clearInterval(typingInterval);
            isGenerating = false;
            toggleSendStop(false);
            showTypingIndicator(false);
            toggleSendButtonState();
            return;
        }

        stopTTS(); // Clean up audio on new user msg
        const inputEl = activeInput === 'welcome' ? welcomeUserInput : userInput;
        const sendBtn = activeInput === 'welcome' ? btnSendWelcome : btnSend;
        const text = inputEl.value.trim();

        if (!text && pendingAttachments.length === 0) return;
        if (!modelReady && !apiKey) {
            showToast("AI engine not ready. Set API key in Settings or wait.");
            return;
        }

        inputEl.value = ''; inputEl.style.height = 'auto';

        // Format prompt explicitly for attachments if any
        let fullPrompt = text;
        const attachmentsCopy = [...pendingAttachments];
        if (attachmentsCopy.length > 0) {
            const filesStr = attachmentsCopy.map(a => a.name).join(', ');
            fullPrompt += `\n[User attached files: ${filesStr}]`;
        }

        // ================= AGENTIC ROUTER: Image Generation =================
        // Highly broadened intent matching. Intercepts anything requesting visual creation.
        const isImageIntent = /^(?:can you\s+)?(?:please\s+)?(?:generate|create|make|draw|show(?: me)?).{0,60}(?:image|picture|photo|drawing|pic)/i.test(text);

        if (isImageIntent && navigator.onLine) {
            const imgPrompt = text.trim();
            appendMessage('user', text, attachmentsCopy, false);
            pendingAttachments = []; renderAttachments();

            showTypingIndicator(true);
            toggleSendStop(true);

            // Pollinations.ai free endpoint parses the entire prompt naturally
            const imgUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(imgPrompt)}?nologo=true`;

            const img = new Image();
            img.onload = () => {
                showTypingIndicator(false);
                // Append message with isImage = true, and pass the URL
                appendMessage('ai', `Here is your image:\n\n![${escapeHtml(imgPrompt)}](${imgUrl})`, [], true, true, imgUrl);
                toggleSendStop(false);
                saveCurrentConversation(false);
            };
            img.onerror = () => {
                showTypingIndicator(false);
                appendMessage('ai', `⚠️ Sorry, I couldn't generate the image.`, [], true);
                toggleSendStop(false);
            };
            img.src = imgUrl;
            return; // Stop further processing
        } else if (isImageIntent && !navigator.onLine) {
            showToast("Internet connection required to generate images.");
        }

        // Proceed to append regular message
        appendMessage('user', text || '[Attachment Only]', attachmentsCopy, false);
        pendingAttachments = []; renderAttachments();

        autoScroll = true;
        showTypingIndicator(true);
        toggleSendStop(true); // Turns into STOP button

        globalAbortController = new AbortController();
        const signal = globalAbortController.signal;

        try {
            let finalPromptForLLM = fullPrompt;

            // ================= AGENTIC ROUTER: Web Search Context =================
            if (isWebSearchEnabled && navigator.onLine) {
                showToast("Searching the web...");
                try {
                    // Call the Android Bridge for free web search
                    const searchResults = await new Promise((resolve, reject) => {
                        if (window.AndroidTFLite && window.AndroidTFLite.performWebSearch) {
                            const callbackId = 'search_' + Date.now();
                            pendingCallbacks[callbackId] = resolve;
                            window.AndroidTFLite.performWebSearch(text, callbackId);
                        } else {
                            // FALLBACK: Pure JS Wikipedia scraper for PC/Browser preview where Android is unavailable
                            const cleanQuery = text.replace(/(what is|who is|where is|tell me about|the) /gi, "").trim();
                            fetch(`https://en.wikipedia.org/w/api.php?action=opensearch&origin=*&search=${encodeURIComponent(cleanQuery)}&limit=2&namespace=0&format=json`)
                                .then(res => res.json())
                                .then(data => {
                                    if (data && data.length > 2 && data[2].length > 0) {
                                        resolve("- " + data[2].join("\n- "));
                                    } else {
                                        resolve("");
                                    }
                                })
                                .catch(() => resolve(""));
                        }
                    });

                    if (searchResults && searchResults.trim() !== "") {
                        finalPromptForLLM = `[Web Search Context: ${searchResults}]\n\nAnswer the user using the above context. User Query: ${text}`;
                    }
                } catch (e) {
                    console.warn("Search failed", e);
                    showToast("Web search failed, falling back to local knowledge.");
                }
            } else if (isWebSearchEnabled && !navigator.onLine) {
                showToast("Offline. Bypassing Web Search.");
            }

            let response;
            if (apiKey) {
                const messages = currentConversation.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content }));
                // Inject our modified search prompt into the final message instead of the plain text
                messages[messages.length - 1].content = finalPromptForLLM;

                const systemInstruction = customInstructions.trim() ? (MASTER_SYSTEM_PROMPT + "\n\nUser Custom Instructions:\n" + customInstructions.trim()) : MASTER_SYSTEM_PROMPT;

                try {
                    response = await callAIAPI(messages, apiKey, systemInstruction, signal);
                } catch (apiErr) {
                    if (apiErr.name === 'AbortError') throw apiErr; // Pass abort up
                    console.warn('Cloud API error:', apiErr);
                    if (modelReady && window.AndroidTFLite) {
                        showToast('API error, trying local model...');
                        response = await new Promise((resolve, reject) => {
                            askLocalLLM(buildLocalPrompt(finalPromptForLLM), resolve, reject);
                        });
                    } else {
                        throw new Error(`API call failed: ${apiErr.message}`);
                    }
                }
            } else {
                if (!modelReady || !window.AndroidTFLite) throw new Error('Local model not ready');
                response = await new Promise((resolve, reject) => {
                    askLocalLLM(buildLocalPrompt(finalPromptForLLM), resolve, reject);
                });
            }
            showTypingIndicator(false);
            appendMessage('ai', response, [], true); // True for animate/typing effect
        } catch (err) {
            if (err.name === 'AbortError') {
                showToast('Generation stopped.');
                // Append partial info or ignore
            } else {
                showTypingIndicator(false);
                appendMessage('ai', '⚠️ ' + (err.message || 'Unknown error'), [], false);
            }
        } finally {
            toggleSendStop(false);
            toggleSendButtonState();
            saveCurrentConversation(false);
            renderRecentChats();
            if (activeInput === 'welcome') welcomeUserInput.focus(); else userInput.focus();
        }
    }

    function newChat() {
        if (isGenerating) {
            if (globalAbortController) globalAbortController.abort();
            if (typingInterval) clearInterval(typingInterval);
            isGenerating = false;
            toggleSendStop(false);
        }
        stopTTS();
        if (currentConversation.length > 0) saveCurrentConversation(false);
        activeConversationId = null; currentConversation = []; chatArea.innerHTML = ''; typingIndicatorEl = null;
        welcomeScreen.style.display = 'flex'; chatArea.style.display = 'none';
        welcomeUserInput.value = ''; userInput.value = ''; setActiveInput('welcome');
        renderRecentChats();
        localStorage.removeItem('activeConversationId');
        if (window.AndroidTFLite && typeof window.AndroidTFLite.resetChat === 'function') window.AndroidTFLite.resetChat();
    }

    function clearChat() {
        document.getElementById('confirmDialogTitle').textContent = 'Clear all messages?';
        document.getElementById('confirmDialogMessage').textContent = 'This action cannot be undone.';
        pendingConfirmAction = 'clearChat';
        confirmClearDialog.classList.remove('hidden');
    }

    function performClearChat() {
        stopTTS();
        if (activeConversationId) allConversations = allConversations.filter(c => c.id !== activeConversationId);
        activeConversationId = null; currentConversation = []; chatArea.innerHTML = ''; typingIndicatorEl = null;
        welcomeScreen.style.display = 'flex'; chatArea.style.display = 'none';
        welcomeUserInput.value = ''; userInput.value = ''; setActiveInput('welcome');
        renderRecentChats();
        persistData();
        if (window.AndroidTFLite && typeof window.AndroidTFLite.resetChat === 'function') window.AndroidTFLite.resetChat();
    }

    function performClearCache() {
        stopTTS();
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
        showToast('Cache cleared');
    }

    function exportChat() {
        if (currentConversation.length === 0) { showToast('Nothing to export'); return; }
        const data = JSON.stringify(currentConversation, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `aethos_chat_${Date.now()}.json`; a.click();
        URL.revokeObjectURL(url); showToast('Chat exported');
    }

    // Message Actions (Copy, Speak, Edit, Download)
    chatArea.addEventListener('click', (e) => {
        const copyBtn = e.target.closest('.copy-msg-btn');
        const speakBtn = e.target.closest('.speak-msg-btn');
        const editBtn = e.target.closest('.edit-msg-btn');
        const downloadBtn = e.target.closest('.download-img-btn');

        if (downloadBtn) {
            const url = downloadBtn.getAttribute('data-url');
            downloadImage(url, 'Aethos_Generated_Image_' + Date.now() + '.jpg');
        }

        if (copyBtn) {
            const wrapper = copyBtn.closest('.message-wrapper');
            const content = wrapper?.getAttribute('data-content') || '';
            navigator.clipboard.writeText(content).then(() => showToast('Copied', 1500)).catch(() => showToast('Copy failed', 1500));
        }

        if (editBtn) {
            stopTTS(); // Explicitly stop audio if user edits the message

            const wrapper = editBtn.closest('.message-wrapper');
            let content = wrapper?.getAttribute('data-content') || '';
            if (content === '[Attachment Only]') content = ''; // Clean up fallback text

            const activeInputEl = activeInput === 'welcome' ? welcomeUserInput : userInput;
            activeInputEl.value = content;
            activeInputEl.style.height = 'auto';
            activeInputEl.style.height = Math.min(activeInputEl.scrollHeight, 120) + 'px';
            activeInputEl.focus();
            toggleSendButtonState();

            // Slicing logic: remove this message and everything after it
            const wrappers = Array.from(chatArea.querySelectorAll('.message-wrapper'));
            const index = wrappers.indexOf(wrapper);

            if (index !== -1) {
                if (index === 0 && wrappers.length <= 2) {
                    // It's basically a new chat again
                }

                for (let i = wrappers.length - 1; i >= index; i--) {
                    wrappers[i].remove();
                }
                currentConversation = currentConversation.slice(0, index);
                saveCurrentConversation(false);
            }
        }

        if (speakBtn) {
            const wrapper = speakBtn.closest('.message-wrapper');
            const content = wrapper?.getAttribute('data-content') || '';

            // OFFLINE TTS BRIDGE CALL
            if (window.PiperTTS && typeof window.PiperTTS.speak === 'function') {
                stopTTS(); // Clean state before new speech

                currentUtterance = { _isPiper: true };
                audioPlayer.classList.remove('hidden');
                audioProgressFill.style.width = '0%';
                audioIconPlay.style.display = 'none';
                audioIconPause.style.display = 'block';
                speakBtn.classList.add('speaking');

                window.PiperTTS.speak(content);

                let simulatedProgress = 0;
                let expectedDuration = (content.length / 15) * 1000;
                let intervalTime = 100;
                let increment = (intervalTime / expectedDuration) * 100;

                currentUtterance._progressInterval = setInterval(() => {
                    simulatedProgress += increment;
                    if (simulatedProgress > 95) simulatedProgress = 95;
                    audioProgressFill.style.width = `${simulatedProgress}%`;
                }, intervalTime);

                // Auto close fallback for offline TTS
                setTimeout(() => {
                    if (currentUtterance && currentUtterance._isPiper) {
                        stopTTS();
                    }
                }, expectedDuration + 2000);

            } else if (window.speechSynthesis) {
                stopTTS(); // Clean state before new speech

                currentUtterance = new SpeechSynthesisUtterance(content);
                const totalLength = content.length || 1;

                audioPlayer.classList.remove('hidden');
                audioProgressFill.style.width = '0%';
                audioIconPlay.style.display = 'none';
                audioIconPause.style.display = 'block';

                currentUtterance.onstart = () => {
                    speakBtn.classList.add('speaking');

                    // Fallback simulated progress for Android WebView where onboundary might fail
                    let simulatedProgress = 0;
                    let expectedDuration = (content.length / 15) * 1000;
                    let intervalTime = 100;
                    let increment = (intervalTime / expectedDuration) * 100;

                    currentUtterance._progressInterval = setInterval(() => {
                        simulatedProgress += increment;
                        if (simulatedProgress > 95) simulatedProgress = 95;
                        audioProgressFill.style.width = `${simulatedProgress}%`;
                    }, intervalTime);
                };

                currentUtterance.onboundary = (event) => {
                    // If true onboundary fires, stop the simulation
                    if (currentUtterance && currentUtterance._progressInterval) {
                        clearInterval(currentUtterance._progressInterval);
                        currentUtterance._progressInterval = null;
                    }
                    if (event.name === 'word') {
                        const progressPercentage = (event.charIndex / totalLength) * 100;
                        audioProgressFill.style.width = `${Math.min(progressPercentage, 100)}%`;
                    }
                };

                const finishAudio = () => {
                    stopTTS();
                };

                currentUtterance.onend = finishAudio;
                currentUtterance.onerror = finishAudio;

                window.speechSynthesis.speak(currentUtterance);
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

    // Audio Player Controls
    audioPlayPauseBtn.addEventListener('click', () => {
        if (window.speechSynthesis) {
            if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
                window.speechSynthesis.pause();
                audioIconPlay.style.display = 'block';
                audioIconPause.style.display = 'none';
            } else if (window.speechSynthesis.paused) {
                window.speechSynthesis.resume();
                audioIconPlay.style.display = 'none';
                audioIconPause.style.display = 'block';
            }
        }
    });

    audioCloseBtn.addEventListener('click', stopTTS);

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
    mobileNewChatBtn.addEventListener('click', () => { newChat(); if (window.innerWidth <= 768) { closeSidebar(); } });

    document.getElementById('confirmClearCancel').addEventListener('click', () => {
        confirmClearDialog.classList.add('hidden');
        pendingConfirmAction = null;
    });

    document.getElementById('confirmClearOk').addEventListener('click', () => {
        confirmClearDialog.classList.add('hidden');
        if (pendingConfirmAction === 'clearChat') {
            performClearChat();
            showToast('Chat cleared');
        } else if (pendingConfirmAction === 'clearCache') {
            performClearCache();
        }
        pendingConfirmAction = null;
    });

    btnSend.addEventListener('click', sendMessage);
    btnSendWelcome.addEventListener('click', sendMessage);

    function handleEnterKey(e, inputEl) {
        if (sendOnEnter && e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const sendBtn = activeInput === 'welcome' ? btnSendWelcome : btnSend;
            if (!sendBtn.disabled || isGenerating) sendMessage();
        }
    }

    welcomeUserInput.addEventListener('keydown', e => handleEnterKey(e, welcomeUserInput));
    userInput.addEventListener('keydown', e => handleEnterKey(e, userInput));

    welcomeUserInput.addEventListener('input', function () {
        this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        toggleSendButtonState();
    });
    userInput.addEventListener('input', function () {
        this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        toggleSendButtonState();
    });

    document.querySelectorAll('.suggested-prompt').forEach(btn => {
        btn.addEventListener('click', function () {
            const prompt = this.getAttribute('data-prompt');
            if (activeInput === 'welcome') welcomeUserInput.value = prompt; else userInput.value = prompt;
            toggleSendButtonState();
            sendMessage();
        });
    });

    searchInput.addEventListener('input', renderRecentChats);

    // ─── Sidebar toggle (Clean CSS Toggles) ───
    function openSidebar() {
        sidebar.classList.add('open');
        overlay.classList.add('active');
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    }

    document.getElementById('sidebarExpandBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        openSidebar();
    });

    overlay.addEventListener('click', closeSidebar);
    desktopSidebarToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        document.body.classList.toggle('sidebar-collapsed');
    });

    // ─── Relaxed Swipe Gestures (Mobile Only) ───
    function initSwipeGestures() {
        let touchStartX = 0;
        let touchStartY = 0;

        document.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].clientX;
            touchStartY = e.changedTouches[0].clientY;
        }, { passive: true });

        document.addEventListener('touchend', (e) => {
            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;

            const deltaX = touchEndX - touchStartX;
            const deltaY = touchEndY - touchStartY;

            // Relaxed swipe logic: Horizontal distance must be greater than vertical, and exceed 40px
            if (Math.abs(deltaX) > 40 && Math.abs(deltaX) > Math.abs(deltaY)) {

                // FIX: Close keyboard if an input is focused during a swipe
                if (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT') {
                    document.activeElement.blur();
                }

                const isOpen = sidebar.classList.contains('open');
                const isMessage = e.target.closest('.message-wrapper');

                if (deltaX > 0 && !isOpen) {
                    // Swipe right to OPEN
                    if (!isMessage || touchStartX < 30) {
                        openSidebar();
                    }
                } else if (deltaX < 0 && isOpen) {
                    // Swipe left to CLOSE
                    closeSidebar();
                }
            }
        }, { passive: true });
    }

    if (window.innerWidth <= 768) {
        initSwipeGestures();
    }

    // Settings
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

    // ==================== User Account Modal ====================
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

    // ==================== Attach popup ====================
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

                Array.from(files).forEach(file => {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        pendingAttachments.push({
                            name: file.name,
                            type: file.type,
                            url: ev.target.result
                        });
                        renderAttachments();
                        toggleSendButtonState();
                    };
                    reader.readAsDataURL(file);
                });
            });
            input.click();
        };

        cameraBtn.addEventListener('click', () => {
            popup.classList.add('hidden');
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
            input.style.display = 'none';
            document.body.appendChild(input);
            handleFileInput(input);
        });
        photosBtn.addEventListener('click', () => {
            popup.classList.add('hidden');
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'image/*';
            input.style.display = 'none';
            document.body.appendChild(input);
            handleFileInput(input);
        });
        filesBtn.addEventListener('click', () => {
            popup.classList.add('hidden');
            const input = document.createElement('input');
            input.type = 'file'; input.accept = '*/*'; input.multiple = true;
            input.style.display = 'none';
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

    // ==================== Mic ====================
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
            document.getElementById('confirmDialogTitle').textContent = 'Clear all app data?';
            document.getElementById('confirmDialogMessage').textContent = 'This will remove chat history and reset preferences. Your API key will be kept.';
            pendingConfirmAction = 'clearCache';
            confirmClearDialog.classList.remove('hidden');
        });
        const modalButtons = settingsModal.querySelector('.modal-buttons');
        if (modalButtons) { modalButtons.parentNode.insertBefore(clearCacheBtn, modalButtons); }
        else { settingsModal.appendChild(clearCacheBtn); }
    }

    // Input focus scroll
    function scrollInputIntoView(e) {
        if (window.innerWidth <= 768) return; // FIX: Prevent jumping / scrolling issues on mobile keyboard popup
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
        toggleSendButtonState();
        if (!activeConversationId) {
            welcomeUserInput.focus();
        }
    }

    if (splashLogoImg) splashLogoImg.src = (savedTheme === 'dark') ? 'logo-white.png' : 'logo-black.png';

    setTimeout(() => { hideSplash(); startApp(); }, 2500);
    setActiveInput('welcome');
})();