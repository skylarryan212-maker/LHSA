import * as vscode from 'vscode';

const SUPABASE_URL = 'https://tvjbhlxewbunhkppqbpl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2amJobHhld2J1bmhrcHBxYnBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxMDEwMjksImV4cCI6MjA3ODQ2MTAyOX0.oX55a76R0ovZy0-vrGqkfRbTLK9M1v7Hooc611I4moU';

const AUTH_ACCESS_TOKEN_KEY = 'lhsa.auth.accessToken';
const AUTH_REFRESH_TOKEN_KEY = 'lhsa.auth.refreshToken';
const AUTH_PKCE_VERIFIER_KEY = 'lhsa.auth.pkceVerifier';

async function isAuthenticated(context: vscode.ExtensionContext) {
    const accessToken = await context.secrets.get(AUTH_ACCESS_TOKEN_KEY);
    return Boolean(accessToken);
}

function buildRedirectUri(context: vscode.ExtensionContext) {
    return vscode.Uri.parse(`vscode://${context.extension.id}/auth-callback`);
}

function parseFragmentParams(fragment: string) {
    const params = new URLSearchParams(fragment ?? '');
    const accessToken = params.get('access_token') ?? undefined;
    const refreshToken = params.get('refresh_token') ?? undefined;
    const error = params.get('error') ?? undefined;
    const errorDescription = params.get('error_description') ?? undefined;
    const state = params.get('state') ?? undefined;
    return { accessToken, refreshToken, error, errorDescription, state };
}

function toBase64Url(bytes: Uint8Array) {
    const base64 = Buffer.from(bytes).toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Base64Url(text: string) {
    const bytes = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return toBase64Url(new Uint8Array(hash));
}

function randomVerifier() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return toBase64Url(bytes);
}

function createAuthUrl(context: vscode.ExtensionContext, pkceChallenge: string) {
    const redirectUri = buildRedirectUri(context);
    const url = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
    url.searchParams.set('provider', 'google');
    url.searchParams.set('redirect_to', redirectUri.toString());
    url.searchParams.set('code_challenge', pkceChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
}

async function validateSupabaseAccessToken(accessToken: string) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${accessToken}`,
        },
    });
    return response.ok;
}

async function fetchUserInfo(context: vscode.ExtensionContext) {
    const accessToken = await context.secrets.get(AUTH_ACCESS_TOKEN_KEY);
    if (!accessToken) {
        return null;
    }

    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!userResponse.ok) {
        return null;
    }

    const user = (await userResponse.json()) as Record<string, any>;

    // Attempt to read plan from supabase table `user_plans` (plan_type column)
    let plan: string | undefined = user.user_metadata?.plan;
    try {
        const userId = user.id;
        if (userId) {
            const restUrl = `${SUPABASE_URL}/rest/v1/user_plans?user_id=eq.${encodeURIComponent(userId)}&select=plan_type&limit=1`;
            const planResp = await fetch(restUrl, {
                headers: {
                    apikey: SUPABASE_ANON_KEY,
                    Authorization: `Bearer ${accessToken}`,
                    Prefer: 'return=representation',
                },
            });
            if (planResp.ok) {
                const plans = (await planResp.json()) as Array<{ plan_type?: string }>;
                if (plans.length > 0 && plans[0].plan_type) {
                    plan = plans[0].plan_type;
                }
            }
        }
    } catch {
        // ignore and fall back to metadata/defaults
    }

    const normalizedPlan = (() => {
        if (!plan) { return 'Plus'; }
        const value = String(plan).toLowerCase();
        if (value === 'dev') { return 'Max'; }
        if (value === 'max') { return 'Max'; }
        if (value === 'plus') { return 'Plus'; }
        return value.charAt(0).toUpperCase() + value.slice(1);
    })();

    return {
        email: user.email ?? 'Unknown',
        plan: normalizedPlan,
    };
}

export async function activate(context: vscode.ExtensionContext) {
    const panels = new Set<vscode.WebviewPanel>();

    context.subscriptions.push(vscode.window.registerUriHandler({
        async handleUri(uri: vscode.Uri) {
            if (uri.path !== '/auth-callback') {
                return;
            }

            const { accessToken, refreshToken, error, errorDescription } = parseFragmentParams(uri.fragment);
            const queryParams = new URLSearchParams(uri.query ?? '');
            const code = queryParams.get('code') ?? undefined;

            if (error) {
                vscode.window.showErrorMessage(`Login failed: ${errorDescription ?? error}`);
                return;
            }

            if (code) {
                const verifier = context.globalState.get<string>(AUTH_PKCE_VERIFIER_KEY);
                if (!verifier) {
                    vscode.window.showErrorMessage('Login failed: missing PKCE verifier. Please try logging in again.');
                    return;
                }

                const tokenResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
                    method: 'POST',
                    headers: {
                        apikey: SUPABASE_ANON_KEY,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
                });

                if (!tokenResponse.ok) {
                    const text = await tokenResponse.text();
                    vscode.window.showErrorMessage(`Login failed: token exchange error (${tokenResponse.status}). ${text}`);
                    return;
                }

                const session = await tokenResponse.json() as { access_token?: string; refresh_token?: string };
                if (!session.access_token) {
                    vscode.window.showErrorMessage('Login failed: token exchange did not return an access token.');
                    return;
                }

                const ok = await validateSupabaseAccessToken(session.access_token);
                if (!ok) {
                    vscode.window.showErrorMessage('Login failed: Supabase token validation failed.');
                    return;
                }

                await context.secrets.store(AUTH_ACCESS_TOKEN_KEY, session.access_token);
                if (session.refresh_token) {
                    await context.secrets.store(AUTH_REFRESH_TOKEN_KEY, session.refresh_token);
                }
                await context.globalState.update(AUTH_PKCE_VERIFIER_KEY, undefined);
                panels.forEach(p => p.webview.postMessage({ type: 'loggedIn' }));
                return;
            }

            if (accessToken) {
                const ok = await validateSupabaseAccessToken(accessToken);
                if (!ok) {
                    vscode.window.showErrorMessage('Login failed: Supabase token validation failed.');
                    return;
                }

                await context.secrets.store(AUTH_ACCESS_TOKEN_KEY, accessToken);
                if (refreshToken) {
                    await context.secrets.store(AUTH_REFRESH_TOKEN_KEY, refreshToken);
                }
                panels.forEach(p => p.webview.postMessage({ type: 'loggedIn' }));
                return;
            }

            vscode.window.showErrorMessage('Login failed: missing auth code.');
        },
    }));

    const handlePanelMessage = async (message: any, panel: vscode.WebviewPanel) => {
        switch (message.type) {
            case 'sendCommand': {
                console.log(`LHSA Command Center prompt: ${message.value}`);
                return;
            }
            case 'openAuth': {
                const verifier = randomVerifier();
                const challenge = await sha256Base64Url(verifier);
                await context.globalState.update(AUTH_PKCE_VERIFIER_KEY, verifier);
                const authUrl = createAuthUrl(context, challenge);
                try {
                    await vscode.env.openExternal(vscode.Uri.parse(authUrl));
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Could not open login page: ${err?.message ?? err}`);
                }
                return;
            }
            case 'authComplete': {
                const authed = await isAuthenticated(context);
                if (authed) {
                    panel.webview.postMessage({ type: 'loggedIn' });
                } else {
                    vscode.window.showErrorMessage('Not logged in yet. Complete the browser login first.');
                }
                return;
            }
            case 'webviewReady': {
                const authed = await isAuthenticated(context);
                panel.webview.postMessage({ type: 'init', authenticated: authed });
                return;
            }
            case 'requestUserInfo': {
                const info = await fetchUserInfo(context);
                panel.webview.postMessage({ type: 'userInfo', payload: info });
                return;
            }
            case 'logout': {
                await context.secrets.delete(AUTH_ACCESS_TOKEN_KEY);
                await context.secrets.delete(AUTH_REFRESH_TOKEN_KEY);
                panels.forEach(p => p.webview.postMessage({ type: 'loggedOut' }));
                return;
            }
            case 'newChat': {
                await openNewPanel(vscode.ViewColumn.Active);
                return;
            }
        }
    };

    const openNewPanel = async (column: vscode.ViewColumn) => {
        const panel = vscode.window.createWebviewPanel(
            'lhsaCommandCenter',
            'LHSA Command Center',
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        panels.add(panel);

        panel.onDidDispose(() => {
            panels.delete(panel);
        }, null, context.subscriptions);

        const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.js'));
        const csp = `default-src 'none'; img-src ${panel.webview.cspSource} https:; script-src ${panel.webview.cspSource}; style-src ${panel.webview.cspSource} 'unsafe-inline'; font-src ${panel.webview.cspSource};`;
                panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
    <div id="root"></div>
    <div id="__lhsa_error_overlay" style="position:fixed;inset:12px;z-index:99999;pointer-events:none;display:none">
        <div style="pointer-events:auto;background:rgba(0,0,0,0.85);color:#fff;padding:12px;border-radius:8px;max-height:60vh;overflow:auto;font-family:monospace;font-size:12px;white-space:pre-wrap"></div>
    </div>
    <script>
        (function(){
            function showError(msg){
                try{
                    const outer = document.getElementById('__lhsa_error_overlay');
                    if(!outer) return;
                    const inner = outer.querySelector('div');
                    inner.textContent = String(msg);
                    outer.style.display = 'block';
                }catch(e){console.error(e)}
            }
            window.addEventListener('error', function(ev){
                showError('Error: ' + (ev && ev.message) + '\n' + (ev && ev.filename ? ev.filename + ':' + ev.lineno + ':' + ev.colno + '\n' : '') + (ev && ev.error && ev.error.stack ? ev.error.stack : ''));
            });
            window.addEventListener('unhandledrejection', function(ev){
                showError('Unhandled Rejection: ' + (ev && ev.reason && ev.reason.stack ? ev.reason.stack : JSON.stringify(ev && ev.reason)));
            });
            window.onerror = function(msg, src, line, col, err){
                showError('onerror: ' + msg + '\n' + (src ? (src + ':' + line + ':' + col + '\n') : '') + (err && err.stack ? err.stack : ''));
            };
            // small heartbeat to ensure the DOM is present for early failures
            setTimeout(function(){
                if(!document.getElementById('root')){
                    showError('Missing #root in webview DOM');
                }
            },1000);
        })();
    </script>
    <script src="${scriptUri}"></script>
</body>
</html>`;
        panel.webview.onDidReceiveMessage(async message => await handlePanelMessage(message, panel), undefined, context.subscriptions);

        const authenticated = await isAuthenticated(context);
        panel.webview.postMessage({ type: 'init', authenticated });

        return panel;
    };

    const startAgent = vscode.commands.registerCommand('lhsa.startAgent', () => {
        if (panels.size) {
            const firstPanel = panels.values().next().value;
            if (firstPanel) {
                firstPanel.reveal(vscode.ViewColumn.One);
                return;
            }
        }
        void openNewPanel(vscode.ViewColumn.One);
    });

    context.subscriptions.push(startAgent);
}

function getHtmlContent() {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>LHSA Command Center</title>
            <style>
                :root {
                    color-scheme: dark;
                    --font-sans: 'Geist', 'Geist Fallback', 'Segoe UI', system-ui, sans-serif;
                    --text-primary: #e7e9ee;
                    --text-muted: #cfd3dd;
                    font-family: var(--font-sans);
                }

                * {
                    box-sizing: border-box;
                }

                body {
                    margin: 0;
                    min-height: 100vh;
                    background: #070707;
                    color: var(--text-primary);
                    display: flex;
                    flex-direction: column;
                    align-items: stretch;
                    overflow-y: auto;
                    overflow-x: hidden;
                    padding-top: 48px;
                    overscroll-behavior-y: contain;
                }

                .stage {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 1.15rem;
                    letter-spacing: 0.05rem;
                    text-transform: none;
                    color: var(--text-muted);
                }

                .prompt-bar {
                    position: sticky;
                    bottom: 0;
                    width: 100%;
                    background: #070707;
                    border: none;
                    padding: 14px 0 22px;
                    display: flex;
                    justify-content: center;
                    z-index: 2;
                }

                .messages {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    padding: 12px 22px 140px;
                    min-height: 0;
                }

                .chat-toolbar {
                    display: flex;
                    justify-content: flex-end;
                    align-items: center;
                    grid-column: 3;
                    justify-self: end;
                    align-self: center;
                }

                .toolbar-right {
                    position: relative;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .toolbar-icon {
                    width: 30px;
                    height: 30px;
                    display: grid;
                    place-items: center;
                    border-radius: 10px;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    cursor: pointer;
                    transition: background 0.2s ease, border-color 0.2s ease;
                }

                .toolbar-icon:hover {
                    background: rgba(255, 255, 255, 0.1);
                    border-color: rgba(255, 255, 255, 0.18);
                }

                .toolbar-icon svg {
                    width: 16px;
                    height: 16px;
                    stroke: #cfd3dd;
                    stroke-width: 1.6;
                    fill: none;
                    stroke-linecap: round;
                    stroke-linejoin: round;
                }

                .settings-menu {
                    position: absolute;
                    top: 42px;
                    right: 0;
                    background: #080808;
                    border: 1px solid rgba(255, 255, 255, 0.09);
                    border-radius: 24px;
                    padding: 12px;
                    min-width: 280px;
                    display: none;
                    flex-direction: column;
                    gap: 8px;
                    box-shadow: 0 30px 60px rgba(0, 0, 0, 0.65);
                }

                .settings-menu.visible {
                    display: flex;
                }

                .speed-card {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }

                .speed-card-title {
                    font-size: 0.85rem;
                    letter-spacing: 0.18rem;
                    text-transform: uppercase;
                    color: #9aa0ad;
                    font-weight: 600;
                }

                .speed-options {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    padding-top: 2px;
                }

                .speed-option {
                    padding: 8px 10px;
                    border-radius: 14px;
                    background: #0d0d0d;
                    border: 1px solid rgba(255, 255, 255, 0.05);
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    cursor: pointer;
                    transition: border-color 0.2s ease, background 0.2s ease;
                }

                .speed-option:hover {
                    border-color: rgba(255, 255, 255, 0.3);
                    background: rgba(255, 255, 255, 0.02);
                }

                .speed-label {
                    font-size: 0.95rem;
                    font-weight: 600;
                    color: #ffffff;
                }

                .speed-description {
                    font-size: 0.78rem;
                    color: #cfd3dd;
                }

                .speed-divider {
                    height: 1px;
                    background: rgba(255, 255, 255, 0.08);
                }

                .extra-nav {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 6px 10px;
                    border-radius: 12px;
                    font-weight: 500;
                    color: #e5e8f1;
                    cursor: pointer;
                }
                .extra-nav svg {
                    width: 14px;
                    height: 14px;
                    stroke: #9aa0ad;
                    stroke-width: 1.5;
                    fill: none;
                }

                .status-wrapper {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    z-index: 3;
                    background: #070707;
                    height: 48px;
                    padding: 8px 16px;
                    display: flex;
                    justify-content: flex-end;
                    align-items: center;
                }

                .scroll-spacer {
                    width: 100%;
                    height: 0;
                    pointer-events: none;
                }

                .messages-inner {
                    width: min(768px, calc(100% - 40px));
                    margin: 0 auto;
                    display: flex;
                    flex-direction: column;
                    gap: 14px;
                    min-height: 0;
                }

                .message-row {
                    display: flex;
                }

                .message-row.user {
                    justify-content: flex-end;
                }

                .message-bubble {
                    max-width: min(70%, 520px);
                    background: #121212;
                    border: 1px solid #1E1E1E;
                    color: #e7e9ee;
                    padding: 10px 14px;
                    border-radius: 16px;
                    font-size: 0.95rem;
                    line-height: 1.4;
                }

                .assistant-line {
                    max-width: min(70%, 520px);
                    color: #cfd3dd;
                    font-size: 0.95rem;
                    line-height: 1.4;
                }

                .login-stage {
                    width: min(520px, calc(100% - 32px));
                    margin: 0 auto;
                    border-radius: 22px;
                    border: 1px solid #1b1b1b;
                    padding: 32px;
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                    background: #0a0a0a;
                    text-align: left;
                }

                .login-stage h1 {
                    margin: 0;
                    font-size: 1.2rem;
                    letter-spacing: 0.08rem;
                    text-transform: uppercase;
                    color: #e7e7f0;
                }

                .login-stage p {
                    color: #b7bccd;
                    margin: 0;
                    line-height: 1.6;
                }

                .login-actions {
                    display: flex;
                    gap: 10px;
                    flex-direction: column;
                }

                .login-actions button {
                    width: 100%;
                    padding: 12px 18px;
                    border: 1px solid transparent;
                    border-radius: 14px;
                    font-weight: 600;
                    cursor: pointer;
                }

                .login-actions .filled {
                    background: #ffffff;
                    color: #0b0b0b;
                }

                .login-actions .secondary {
                    background: transparent;
                    border-color: #1e1e1e;
                    color: #cfd3dd;
                }

                .login-footer {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 10px;
                    font-size: 0.8rem;
                    color: #a6abba;
                }

                .login-footer .ghost {
                    border: 1px solid #1e1e1e;
                    background: transparent;
                    padding: 6px 12px;
                    border-radius: 999px;
                    color: #d1d6e5;
                    cursor: pointer;
                }

                .composer-shell {
                    width: min(768px, calc(100% - 40px));
                    height: 62px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 10px;
                    padding: 10px 16px;
                    background: #0A0A0A;
                    border-radius: 24px;
                    border: 1px solid #262626;
                    box-shadow: 0 20px 35px rgba(0, 0, 0, 0.7);
                }

                .composer-shell textarea {
                    flex: 1;
                    min-width: 0;
                    height: 40px;
                    resize: none;
                    border: none;
                    border-radius: 18px;
                    padding: 10px 14px;
                    background: #0A0A0A;
                    color: #f0f2f6;
                    font-size: 1rem;
                    font-family: inherit;
                    line-height: 20px;
                    outline: none;
                    letter-spacing: 0.01rem;
                    overflow: hidden;
                    white-space: nowrap;
                }

                .composer-shell textarea::placeholder {
                    color: var(--text-muted);
                }

                .icon-button {
                    width: 40px;
                    height: 40px;
                    border-radius: 14px;
                    border: 1px solid rgba(255, 255, 255, 0.06);
                    background: rgba(255, 255, 255, 0.04);
                    display: grid;
                    place-items: center;
                    cursor: pointer;
                    transition: background 0.2s ease, border-color 0.2s ease;
                }

                .icon-button svg {
                    width: 17px;
                    height: 17px;
                    fill: #c1c3e0;
                }

                .icon-button:hover {
                    background: rgba(255, 255, 255, 0.12);
                    border-color: rgba(255, 255, 255, 0.2);
                }

                .send-button {
                    width: 44px;
                    height: 44px;
                    border-radius: 50%;
                    border: none;
                    background: #f8fbfe;
                    color: #111;
                    display: grid;
                    place-items: center;
                    cursor: pointer;
                    transition: transform 0.15s ease, box-shadow 0.2s ease;
                    box-shadow: 0 12px 22px rgba(2, 6, 23, 0.35);
                }

                .send-button svg {
                    width: 18px;
                    height: 18px;
                    stroke: currentColor;
                    stroke-width: 2;
                    fill: none;
                }

                .send-button:active {
                    transform: translateY(1px);
                }

                .send-button:disabled {
                    opacity: 0.45;
                    cursor: not-allowed;
                    box-shadow: none;
                }

                @media (max-width: 720px) {
                    .composer-shell {
                        width: calc(100% - 28px);
                    }

                    .composer-shell textarea {
                        height: auto;
                    }

                    .composer-shell button {
                        width: 40px;
                    }
                }
            </style>
        </head>
        <body>
            <div class="messages" id="messagesStage">
                <div class="status-wrapper">
                    <div class="chat-toolbar">
                        <div class="toolbar-right">
                            <button class="toolbar-icon" id="historyButton" aria-label="History">
                                <svg viewBox="0 0 24 24">
                                    <path d="M3 12a9 9 0 1 0 3-6"></path>
                                    <path d="M3 4v4h4"></path>
                                    <path d="M12 7v5l3 2"></path>
                                </svg>
                            </button>
                            <button class="toolbar-icon" id="newChatButton" aria-label="New chat">
                                <svg viewBox="0 0 24 24">
                                    <path d="M12 5v14"></path>
                                    <path d="M5 12h14"></path>
                                </svg>
                            </button>
                            <button class="toolbar-icon" id="settingsButton" aria-label="Settings">
                                <svg viewBox="0 0 24 24">
                                    <defs>
                                        <mask id="lhsaGearMask">
                                            <rect width="24" height="24" fill="black" stroke="none"></rect>
                                            <g fill="white" stroke="none">
                                                <circle cx="12" cy="12" r="7.2"></circle>
                                                <rect x="10.75" y="1.8" width="2.5" height="3" rx="0.9"></rect>
                                                <rect x="10.75" y="1.8" width="2.5" height="3" rx="0.9" transform="rotate(45 12 12)"></rect>
                                                <rect x="10.75" y="1.8" width="2.5" height="3" rx="0.9" transform="rotate(90 12 12)"></rect>
                                                <rect x="10.75" y="1.8" width="2.5" height="3" rx="0.9" transform="rotate(135 12 12)"></rect>
                                                <rect x="10.75" y="1.8" width="2.5" height="3" rx="0.9" transform="rotate(180 12 12)"></rect>
                                                <rect x="10.75" y="1.8" width="2.5" height="3" rx="0.9" transform="rotate(225 12 12)"></rect>
                                                <rect x="10.75" y="1.8" width="2.5" height="3" rx="0.9" transform="rotate(270 12 12)"></rect>
                                                <rect x="10.75" y="1.8" width="2.5" height="3" rx="0.9" transform="rotate(315 12 12)"></rect>
                                            </g>
                                            <circle cx="12" cy="12" r="3" fill="black" stroke="none"></circle>
                                        </mask>
                                    </defs>
                                    <rect width="24" height="24" fill="#cfd3dd" stroke="none" mask="url(#lhsaGearMask)"></rect>
                                </svg>
                            </button>
                        <div class="settings-menu" id="settingsMenu">
                            <div class="speed-card">
                                <div class="speed-card-title">GPT 5.2</div>
                                <div class="speed-options">
                                    <div class="speed-option">
                                        <span class="speed-label">Auto</span>
                                        <span class="speed-description">Auto routing</span>
                                    </div>
                                    <div class="speed-option">
                                        <span class="speed-label">Instant</span>
                                        <span class="speed-description">Answers right away</span>
                                    </div>
                                    <div class="speed-option">
                                        <span class="speed-label">Thinking</span>
                                        <span class="speed-description">Thinks longer for better answers</span>
                                    </div>
                                    <div class="speed-option">
                                        <span class="speed-label">Pro</span>
                                        <span class="speed-description">Highest quality GPT 5.2</span>
                                    </div>
                                </div>
                            </div>
                            <div class="speed-divider"></div>
                            <div class="extra-nav">
                                <span>Other models</span>
                                <svg viewBox="0 0 24 24">
                                    <path d="M8 10l4 4 4-4"></path>
                                </svg>
                            </div>
                            <div class="settings-divider"></div>
                            <div class="settings-item" id="logoutButton">
                                <svg viewBox="0 0 24 24">
                                    <path d="M9 7v-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9v-2"></path>
                                    <path d="M15 12H4"></path>
                                    <path d="M7 9l-3 3 3 3"></path>
                                </svg>
                                <span>Log out</span>
                            </div>
                        </div>
                        </div>
                    </div>
                </div>
                <div id="messages" class="messages-inner"></div>
                <div id="scrollSpacer" class="scroll-spacer" aria-hidden="true"></div>
            </div>
            <div class="login-stage" id="loginStage">
                <h1>Log in to LLM Client</h1>
                <p>Authenticate through your LLM Client account and the extension will remember your session.</p>
                <div class="login-actions">
                    <button class="filled" id="loginWithLLM">Log in with LLM Client</button>
                    <button class="secondary" disabled>Use API Key</button>
                </div>
                <div class="login-footer">
                    <span id="loginStatus">Waiting for you to initiate the login flow.</span>
                    <button id="confirmLogin" class="ghost">Already completed login? Continue</button>
                </div>
            </div>
            <div class="prompt-bar" id="promptStage">
                <div class="composer-shell">
                    <textarea id="cmd" placeholder="What are we working on?" autocomplete="off" rows="1"></textarea>
                    <button id="run" class="send-button" disabled type="button" aria-label="Send command">
                        <svg viewBox="0 0 24 24" role="img" aria-hidden="true" fill="none">
                            <path d="M12 19V5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                            <path d="m5 12 7-7 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                        </svg>
                    </button>
                </div>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                const input = document.getElementById('cmd');
                const button = document.getElementById('run');
                const messages = document.getElementById('messages');
                const loginStage = document.getElementById('loginStage');
                const promptStage = document.getElementById('promptStage');
                const loginStatus = document.getElementById('loginStatus');
                const loginWithLLM = document.getElementById('loginWithLLM');
                const confirmLogin = document.getElementById('confirmLogin');
                const settingsButton = document.getElementById('settingsButton');
                const settingsMenu = document.getElementById('settingsMenu');
                const userEmailLabel = document.getElementById('userEmail');
                const userPlanLabel = document.getElementById('userPlan');
                const logoutButton = document.getElementById('logoutButton');
                const newChatButton = document.getElementById('newChatButton');
                const historyButton = document.getElementById('historyButton');

                const mockReplies = [
                    "Got it. Working through the request now.",
                    "Understood. I will outline next steps shortly.",
                    "Acknowledged. Preparing a response.",
                    "Thanks. I will draft a proposal.",
                    "Received. I am reviewing and will respond."
                ];

                const updateButtonState = () => {
                    const hasText = input.value.trim().length > 0;
                    button.disabled = !hasText;
                };

                const scrollSpacer = document.getElementById('scrollSpacer');
                const statusWrapper = document.querySelector('.status-wrapper');
                let latestUserAnchor = null;

                const scrollToLatestMessage = (behavior = 'auto') => {
                    requestAnimationFrame(() => {
                        const latest = latestUserAnchor || messages.lastElementChild;
                        if (!latest) return;

                        const rect = latest.getBoundingClientRect();
                        const statusOffset = (statusWrapper?.getBoundingClientRect().height || 0) + 12;
                        const top = Math.max(0, rect.top + window.scrollY - statusOffset);

                        // Ensure there is enough scrollable space to pin this message to the top.
                        const doc = document.documentElement;
                        const currentHeight = doc.scrollHeight;
                        const maxScrollTop = Math.max(0, currentHeight - window.innerHeight);
                        const requiredExtra = Math.max(0, top - maxScrollTop + 32);
                        const postScrollSpacer = Math.min(Math.max(requiredExtra + 40, 220), 420);
                        if (scrollSpacer) {
                            scrollSpacer.style.height = postScrollSpacer + 'px';
                        }

                        window.scrollTo({ top, behavior });

                        // After scrolling, clamp to the bottom limit to prevent overscrolling.
                        setTimeout(() => {
                            const nextMax = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
                            if (window.scrollY > nextMax) {
                                window.scrollTo({ top: nextMax, behavior: 'auto' });
                            }
                        }, behavior === 'smooth' ? 400 : 60);
                    });
                };

                const addUserMessage = (text) => {
                    const row = document.createElement('div');
                    row.className = 'message-row user';
                    const bubble = document.createElement('div');
                    bubble.className = 'message-bubble';
                    bubble.textContent = text;
                    row.appendChild(bubble);
                    messages.appendChild(row);
                    latestUserAnchor = row;
                };

                const addAssistantLine = (text) => {
                    const line = document.createElement('div');
                    line.className = 'assistant-line';
                    line.textContent = text;
                    messages.appendChild(line);
                    // First, scroll smoothly with a short delay to let layout settle.
                    setTimeout(() => scrollToLatestMessage('smooth'), 30);
                };

                const messagesStage = document.getElementById('messagesStage');

                const showLoginStage = () => {
                    loginStage.style.display = 'flex';
                    promptStage.style.display = 'none';
                    messagesStage.style.display = 'none';
                };

                const showPromptStage = () => {
                    loginStage.style.display = 'none';
                    promptStage.style.display = 'flex';
                    messagesStage.style.display = 'flex';
                    input.focus();
                };

                const runCommand = () => {
                    const value = input.value.trim();
                    if (!value) return;
                    if (loginStage.style.display !== 'none') {
                        return;
                    }
                    vscode.postMessage({ type: 'sendCommand', value });
                    addUserMessage(value);
                    input.value = '';
                    updateButtonState();
                    input.focus();
                    const reply = mockReplies[Math.floor(Math.random() * mockReplies.length)];
                    setTimeout(() => {
                        addAssistantLine(reply);
                    }, 450);
                };

                loginWithLLM.addEventListener('click', () => {
                    loginStatus.textContent = 'Opening the LLM Client login flow...';
                    vscode.postMessage({ type: 'openAuth' });
                });

                confirmLogin.addEventListener('click', () => {
                    loginStatus.textContent = 'Finishing login...';
                    vscode.postMessage({ type: 'authComplete' });
                });

                button.addEventListener('click', runCommand);

                input.addEventListener('input', () => {
                    updateButtonState();
                });

                input.addEventListener('keydown', event => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        runCommand();
                    }
                });

                loginStage.style.display = 'none';
                promptStage.style.display = 'none';
                messagesStage.style.display = 'none';

                updateButtonState();

                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.type === 'init') {
                        if (message.authenticated) {
                            showPromptStage();
                        } else {
                            showLoginStage();
                        }
                    } else if (message.type === 'loggedIn') {
                        loginStatus.textContent = 'Login successful. You can close the browser tab.';
                        showPromptStage();
                        settingsMenu.classList.remove('visible');
                        vscode.postMessage({ type: 'requestUserInfo' });
                    } else if (message.type === 'loggedOut') {
                        loginStatus.textContent = 'Logged out. Please log in again.';
                        showLoginStage();
                        settingsMenu.classList.remove('visible');
                    } else if (message.type === 'userInfo') {
                        if (message.payload) {
                            userEmailLabel.textContent = message.payload.email;
                            userPlanLabel.textContent = 'Plan: ' + message.payload.plan;
                        }
                    }
                });

                vscode.postMessage({ type: 'webviewReady' });

                settingsButton.addEventListener('click', () => {
                    settingsMenu.classList.toggle('visible');
                    if (settingsMenu.classList.contains('visible')) {
                        vscode.postMessage({ type: 'requestUserInfo' });
                    }
                });

                logoutButton.addEventListener('click', () => {
                    vscode.postMessage({ type: 'logout' });
                });

                newChatButton.addEventListener('click', () => {
                    vscode.postMessage({ type: 'newChat' });
                });

                historyButton.addEventListener('click', () => {
                    // reserved
                });
            </script>
        </body>
        </html>`;
}
