const chatRoomHtml = `
        <header class="app-header" id="chat-room-header-default">
            <button class="back-btn" data-target="chat-list-screen">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>
            <div class="title-container">
                <div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
                    <h1 class="title" id="chat-room-title">...</h1>
                    <button id="char-status-btn" title="状态" style="display: none; background: none; border: none; padding: 0; cursor: pointer; color: #a5c1d6; display: flex; align-items: center;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" class="bi bi-reception-3" viewBox="0 0 16 16">
                            <path d="M0 11.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-2zm4-3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-5zm4-3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-8zm4 8a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5z"/>
                          </svg>
                    </button>
                </div>
                <!-- 在线状态暂时隐藏或移到标题旁，根据KKT风格通常只显示名字 -->
                <div class="subtitle" id="chat-room-subtitle" style="display:none;">
                    <div class="online-indicator"></div>
                    <span id="chat-room-status-text">在线</span>
                </div>
            </div>
            <div class="action-btn-group">
                <button class="action-btn" id="peek-btn" title="偷看" style="position: relative;">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    <span class="nav-badge" id="gossip-badge" style="display: none; top: -2px; right: -2px; width: 8px; height: 8px; padding: 0;"></span>
                </button>
                <button class="action-btn" id="chat-settings-btn" title="设置">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
                </button>
            </div>
        </header>
        <header class="app-header" id="chat-room-header-select" style="display: none;">
            <button class="action-btn" id="cancel-multi-select-btn">取消</button>
            <div class="title-container">
                <h1 class="title" id="multi-select-title">选择消息</h1>
            </div>
            <div class="placeholder"></div>
        </header>
        <main class="content">
            <div class="message-area" id="message-area"></div>
            <div class="typing-indicator" id="typing-indicator"></div>
        </main>
        
        <!-- 角色状态栏覆盖层 -->
        <div id="char-status-overlay" class="status-panel-overlay">
            <div class="status-panel-content" id="char-status-content">
                <!-- JS 动态注入 -->
            </div>
            <button class="close-status-panel" id="close-status-panel-btn">×</button>
        </div>

        <div class="chat-input-wrapper">
            <div id="reply-preview-bar">
                <div class="reply-preview-content">
                    <span class="reply-preview-name"></span>
                    <p class="reply-preview-text"></p>
                </div>
                <button id="cancel-reply-btn">×</button>
            </div>
            <div class="message-input-area" id="message-input-default">
                <button id="toggle-expansion-btn" class="icon-btn circle-bg">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </button>
                <div class="input-wrapper">
                    <input type="text" id="message-input" autocomplete="off" placeholder="">
                    <button id="sticker-toggle-btn" class="icon-btn input-inner-btn">
                        <img src="https://i.postimg.cc/prRC31Gk/retouch-2025110902080890.png" alt="表情">
                    </button>
                </div>
                <button id="get-reply-btn" class="icon-btn">
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="12" cy="12" r="12" fill="#F0F0F0"/>
                        <g fill="#191919">
                            <rect x="11.25" y="5.85" width="1.5" height="12.3" rx="0.2"/>
                            <rect x="8.55" y="8.35" width="1.5" height="7.3" rx="0.2"/>
                            <rect x="13.95" y="8.35" width="1.5" height="7.3" rx="0.2"/>
                            <rect x="5.85" y="10.5" width="1.5" height="3" rx="0.2"/>
                            <rect x="16.65" y="10.5" width="1.5" height="3" rx="0.2"/>
                        </g>
                    </svg>
                </button>
                <button id="send-message-btn" class="icon-btn send-btn circle-bg" style="display: none;">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                </button>
            </div>
        </div>
        
        <!-- 底部功能展开面板 -->
        <div id="chat-expansion-panel">
            <!-- 功能按钮区域 -->
            <div id="panel-function-area" class="panel-area">
                <div class="expansion-grid">
                    <div class="expansion-item" id="regenerate-btn">
                        <div class="expansion-item-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.65,6.35C16.2,4.9,14.21,4,12,4A8,8,0,0,0,4,12A8,8,0,0,0,12,20C15.73,20,18.84,17.45,19.73,14H17.65C16.83,16.33,14.61,18,12,18A6,6,0,0,1,6,12A6,6,0,0,1,12,6C13.66,6,15.14,6.69,16.22,7.78L13,11H20V4L17.65,6.35Z" /></svg>
                        </div>
                        <span class="expansion-item-name">重回</span>
                    </div>
                    <div class="expansion-item" id="photo-video-btn">
                        <div class="expansion-item-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4,4H7L9,2H15L17,4H20A2,2 0 0,1 22,6V18A2,2 0 0,1 20,20H4A2,2 0 0,1 2,18V6A2,2 0 0,1 4,4M12,7A5,5 0 0,0 7,12A5,5 0 0,0 12,17A5,5 0 0,0 17,12A5,5 0 0,0 12,7M12,9A3,3 0 0,1 15,12A3,3 0 0,1 12,15A3,3 0 0,1 9,12A3,3 0 0,1 12,9Z"/></svg>
                        </div>
                        <span class="expansion-item-name">相册</span>
                    </div>
                    <div class="expansion-item" id="image-recognition-btn">
                        <div class="expansion-item-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.58,16.09L19.66,18L18.24,16.58L21,13.83C21.39,13.44 22,13.44 22.39,13.83L23.17,14.61C23.56,15 23.56,15.64 23.17,16.03L21.58,17.62M20.13,12.25L18.71,13.66L20.41,15.36L21.83,13.94L20.13,12.25M5.93,19H5C3.9,19 3,18.1 3,17V5C3,3.9 3.9,3 5,3H19C20.1,3 21,3.9 21,5V11.08L19,13.08V5H5V17H5.93L13.5,9.43L16.29,12.21L12.08,16.42L5.93,19Z"/></svg>
                        </div>
                        <span class="expansion-item-name">识图</span>
                    </div>
                    <div class="expansion-item" id="voice-message-btn">
                        <div class="expansion-item-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg>
                        </div>
                        <span class="expansion-item-name">语音</span>
                    </div>
                    <div class="expansion-item" id="wallet-btn">
                        <div class="expansion-item-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6C22 4.9 21.1 4 20 4ZM20 18H4V8H20V18ZM4 6H20V6H4Z"/></svg>
                        </div>
                        <span class="expansion-item-name">转账</span>
                    </div>
                    <div class="expansion-item" id="gift-btn">
                        <div class="expansion-item-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20,8L12,13L4,8V6H20M20,4H4A2,2 0 0,0 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V6A2,2 0 0,0 20,4M12.5,18C12.5,17.29 12.17,16.65 11.64,16.27C12.17,15.89 12.5,15.26 12.5,14.55C12.5,13.6 11.83,12.79 11,12.58V12H13V10H11V8H13V6H11V5C11,4.45 10.55,4 10,4H8C7.45,4 7,4.45 7,5V6H9V8H7V10H9V12H7V12.58C6.17,12.79 5.5,13.6 5.5,14.55C5.5,15.26 5.83,15.89 6.36,16.27C5.83,16.65 5.5,17.29 5.5,18H12.5Z"/></svg>
                        </div>
                        <span class="expansion-item-name">礼物</span>
                    </div>
                    <div class="expansion-item" id="time-skip-btn">
                        <div class="expansion-item-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 5v14l7-7-7-7zm9 0v14l7-7-7-7z"></path></svg>
                        </div>
                        <span class="expansion-item-name">剧情</span>
                    </div>
                    <div class="expansion-item" id="memory-journal-btn">
                        <div class="expansion-item-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M12,13.09C11.67,13.03 11.34,13 11,13A3,3 0 0,0 8,16A3,3 0 0,0 11,19C12.36,19 13.5,18.15 13.91,17H16V15H13.91C13.5,13.85 12.36,13.09 12,13.09M11,17A1,1 0 0,1 10,16A1,1 0 0,1 11,15A1,1 0 0,1 12,16A1,1 0 0,1 11,17Z" /></svg>
                        </div>
                        <span class="expansion-item-name">日记</span>
                    </div>
                    <div class="expansion-item" id="delete-history-btn">
                        <div class="expansion-item-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/></svg>
                        </div>
                        <span class="expansion-item-name">管理</span>
                    </div>
                    <div class="expansion-item" id="char-gallery-manage-btn">
                        <div class="expansion-item-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 16V4c0-1.1-.9-2-2-2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2zm-11-4l2.03 2.71L16 11l4 5H8l3-4zM2 6v14c0 1.1.9 2 2 2h14v-2H4V6H2z"/></svg>
                        </div>
                        <span class="expansion-item-name">TA相册</span>
                    </div>
                    <div class="expansion-item" id="capture-btn">
                        <div class="expansion-item-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
                        </div>
                        <span class="expansion-item-name">捕获</span>
                    </div>
                    <div class="expansion-item" id="airdrop-panel-btn">
                        <div class="expansion-item-icon">
                            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M10 3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4zM6 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H6z"/><path d="M8 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM1.599 4.058a.5.5 0 0 1 .208.676A6.967 6.967 0 0 0 1 8c0 1.18.292 2.292.807 3.266a.5.5 0 0 1-.884.468A7.968 7.968 0 0 1 0 8c0-1.347.334-2.619.923-3.734a.5.5 0 0 1 .676-.208zm12.802 0a.5.5 0 0 1 .676.208A7.967 7.967 0 0 1 16 8a7.967 7.967 0 0 1-.923 3.734.5.5 0 0 1-.884-.468A6.967 6.967 0 0 0 15 8c0-1.18-.292-2.292-.807-3.266a.5.5 0 0 1 .208-.676zM3.057 5.534a.5.5 0 0 1 .284.648A4.986 4.986 0 0 0 3 8c0 .642.12 1.255.34 1.818a.5.5 0 1 1-.93.364A5.986 5.986 0 0 1 2 8c0-.769.145-1.505.41-2.182a.5.5 0 0 1 .647-.284zm9.886 0a.5.5 0 0 1 .648.284C13.855 6.495 14 7.231 14 8c0 .769-.145 1.505-.41 2.182a.5.5 0 0 1-.93-.364C12.88 9.255 13 8.642 13 8c0-.642-.12-1.255-.34-1.818a.5.5 0 0 1 .283-.648z"/></svg>
                        </div>
                        <span class="expansion-item-name">隔空投送</span>
                    </div>
                    <div class="expansion-item" id="shop-btn">
                        <div class="expansion-item-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.9 8.89l-1.06-4.24C20.67 3.82 19.92 3.25 19.06 3.25h-14.12c-0.86 0-1.61 0.57-1.78 1.4L2.1 8.89c-0.34 1.35 0.38 2.7 1.63 3.12l0.27 0.09V19c0 1.1 0.9 2 2 2h12c1.1 0 2-0.9 2-2v-6.9l0.27-0.09c1.25-0.42 1.97-1.77 1.63-3.12zM12 13c-1.1 0-2-0.9-2-2s0.9-2 2-2 2 0.9 2 2-0.9 2-2 2z"></path></svg>
                        </div>
                        <span class="expansion-item-name">商城</span>
                    </div>
                    <div class="expansion-item" id="video-call-btn">
                        <div class="expansion-item-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" class="bi bi-telephone-outbound" viewBox="0 0 16 16">
                                <path d="M3.654 1.328a.678.678 0 0 0-1.015-.063L1.605 2.3c-.483.484-.661 1.169-.45 1.77a17.568 17.568 0 0 0 4.168 6.608 17.569 17.569 0 0 0 6.608 4.168c.601.211 1.286.033 1.77-.45l1.034-1.034a.678.678 0 0 0-.063-1.015l-2.307-1.794a.678.678 0 0 0-.58-.122l-2.19.547a1.745 1.745 0 0 1-1.657-.459L5.482 8.062a1.745 1.745 0 0 1-.46-1.657l.548-2.19a.678.678 0 0 0-.122-.58L3.654 1.328zM1.884.511a1.745 1.745 0 0 1 2.612.163L6.29 2.98c.329.423.445.974.315 1.494l-.547 2.19a.678.678 0 0 0 .178.643l2.457 2.457a.678.678 0 0 0 .644.178l2.189-.547a1.745 1.745 0 0 1 1.494.315l2.306 1.794c.829.645.905 1.87.163 2.611l-1.034 1.034c-.74.74-1.846 1.065-2.877.702a18.634 18.634 0 0 1-7.01-4.42 18.634 18.634 0 0 1-4.42-7.009c-.362-1.03-.037-2.137.703-2.877L1.885.511zM11 .5a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0V1.707l-4.146 4.147a.5.5 0 0 1-.708-.708L14.293 1H11.5a.5.5 0 0 1-.5-.5z"/>
                            </svg>
                        </div>
                        <span class="expansion-item-name">通话</span>
                    </div>
                    <div class="expansion-item" id="red-packet-btn" style="display: none;">
                        <div class="expansion-item-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" class="bi bi-piggy-bank" viewBox="0 0 16 16">
                                <path d="M5 6.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm1.138-1.496A6.613 6.613 0 0 1 7.964 4.5c.666 0 1.303.097 1.893.273a.5.5 0 0 0 .286-.958A7.602 7.602 0 0 0 7.964 3.5c-.734 0-1.441.103-2.102.292a.5.5 0 1 0 .276.962z"/>
                                <path fill-rule="evenodd" d="M7.964 1.527c-2.977 0-5.571 1.704-6.32 4.125h-.55A1 1 0 0 0 .11 6.824l.254 1.46a1.5 1.5 0 0 0 1.478 1.243h.263c.3.513.688.978 1.145 1.382l-.729 2.477a.5.5 0 0 0 .48.641h2a.5.5 0 0 0 .471-.332l.482-1.351c.635.173 1.31.267 2.011.267.707 0 1.388-.095 2.028-.272l.543 1.372a.5.5 0 0 0 .465.316h2a.5.5 0 0 0 .478-.645l-.761-2.506C13.81 9.895 14.5 8.559 14.5 7.069c0-.145-.007-.29-.02-.431.261-.11.508-.266.705-.444.315.306.815.306.815-.417 0 .223-.5.223-.461-.026a.95.95 0 0 0 .09-.255.7.7 0 0 0-.202-.645.58.58 0 0 0-.707-.098.735.735 0 0 0-.375.562c-.024.243.082.48.32.654a2.112 2.112 0 0 1-.259.153c-.534-2.664-3.284-4.595-6.442-4.595zM2.516 6.26c.455-2.066 2.667-3.733 5.448-3.733 3.146 0 5.536 2.114 5.536 4.542 0 1.254-.624 2.41-1.67 3.248a.5.5 0 0 0-.165.535l.66 2.175h-.985l-.59-1.487a.5.5 0 0 0-.629-.288c-.661.23-1.39.359-2.157.359a6.558 6.558 0 0 1-2.157-.359.5.5 0 0 0-.635.304l-.525 1.471h-.979l.633-2.15a.5.5 0 0 0-.17-.534 4.649 4.649 0 0 1-1.284-1.541.5.5 0 0 0-.446-.275h-.56a.5.5 0 0 1-.492-.414l-.254-1.46h.933a.5.5 0 0 0 .488-.393zm12.621-.857a.565.565 0 0 1-.098.21.704.704 0 0 1-.044-.025c-.146-.09-.157-.175-.152-.223a.236.236 0 0 1 .117-.173c.049-.027.08-.021.113.012a.202.202 0 0 1 .064.199z"/>
                            </svg>
                        </div>
                        <span class="expansion-item-name">红包</span>
                    </div>
                </div>
            </div>

            <!-- 表情包区域 (原 sticker-modal 内容) -->
            <div id="panel-sticker-area" class="panel-area" style="display: none;">
                <!-- 顶部导航行：左侧是分组，右侧是菜单按钮 -->
                <div class="sticker-nav-row">
                    <div id="sticker-category-bar">
                        <!-- JS 动态生成分组 -->
                    </div>
                    <button class="icon-btn-simple" id="sticker-menu-btn">
                        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16Z" /></svg>
                    </button>
                </div>
        
                <!-- 表情列表容器 -->
                <div class="sticker-grid" id="sticker-grid-container"></div>
        
                <!-- 底部管理栏 (仅在多选模式显示) -->
                <div id="sticker-manage-bar">
                    <div class="manage-bar-content">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <button class="btn btn-neutral btn-small" id="select-all-stickers-btn" style="padding: 4px 8px; font-size: 12px;">全选</button>
                            <span id="sticker-select-count" style="font-size: 14px; color: #666;">已选 0 项</span>
                        </div>
                        <div style="display: flex; gap: 10px;">
                            <button class="btn btn-neutral btn-small" id="move-sticker-group-btn">移动分组</button>
                            <button class="btn btn-danger btn-small" id="delete-selected-stickers-btn">删除</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <div id="music-screen" class="screen"></div>

        
        <div id="multi-select-bar"><span id="select-count">已选择 0 项</span>
            <button class="btn btn-danger" id="delete-selected-btn" style="width: auto; padding: 8px 16px;">删除已选
            </button>
        </div>
        <div id="capture-mode-bar">
            <span id="capture-select-count">已选择 0 项</span>
            <button class="btn btn-primary" id="generate-capture-btn" style="width: auto; padding: 8px 16px;">生成截图</button>
        </div>
`;

function injectChatRoomHtml() {
    const container = document.getElementById('chat-room-screen');
    if (container) {
        container.innerHTML = chatRoomHtml;
    }
}
