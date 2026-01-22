const root = document.getElementById('root');

class UI {
    static toggleDebugPanel() {
        const panel = document.getElementById('debug-panel');
        if (panel.style.display === 'none') {
            panel.style.display = 'flex';
        } else {
            panel.style.display = 'none';
        }
    }

    static gotoRootView(viewId) {
        Array.from(root.children).forEach(child => {
            child.style.display = 'none';
        });
        root.querySelector('#' + viewId).style.display = 'flex';
    }
}

UI.toggleDebugPanel();
UI.gotoRootView('main');