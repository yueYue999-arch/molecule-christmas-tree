export function createMoleculeAlbum(onChange) {
    const home = document.getElementById('molecule-album-home');
    const picker = document.getElementById('molecule-photo-picker');
    const input = document.getElementById('molecule-file-input');
    const pick = document.getElementById('molecule-add-photos');
    const list = document.getElementById('molecule-file-list');
    const status = document.getElementById('molecule-file-status');
    const open = document.getElementById('molecule-album-launch');
    const dialog = document.getElementById('molecule-album-dialog');
    const dialogBody = document.getElementById('molecule-album-body');
    let items = [];

    function sources() {
        return items.filter(item => item.ready).map(item => item.url);
    }

    function render(message = '') {
        const ready = sources().length;
        open.textContent = '照片 · ' + ready;
        list.hidden = !items.length;
        list.replaceChildren();
        for (const item of items) {
            const row = document.createElement('li');
            row.className = 'molecule-attachment';
            const preview = document.createElement('img');
            preview.alt = '';
            preview.loading = 'lazy';
            if (item.ready) preview.src = item.url;
            else preview.hidden = true;
            const label = document.createElement('span');
            label.textContent = item.name;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.textContent = '删除';
            remove.setAttribute('aria-label', '删除 ' + item.name);
            remove.addEventListener('click', () => {
                const index = items.indexOf(item);
                items = items.filter(entry => entry !== item);
                onChange(sources());
                URL.revokeObjectURL(item.url);
                render('已删除 ' + item.name);
                (list.children[Math.min(index, list.children.length - 1)]?.querySelector('button') || pick).focus();
            });
            row.append(preview, label, remove);
            list.append(row);
        }
        status.textContent = message || (ready ? '已添加 ' + ready + ' 张照片' : '选择相册中的图片，可分多次添加。');
    }

    async function appendFiles(files) {
        let duplicates = 0;
        const additions = [];
        for (const file of files) {
            const key = JSON.stringify([file.name, file.size, file.lastModified]);
            if (items.some(item => item.key === key)) {
                duplicates++;
                continue;
            }
            const item = { key, url: URL.createObjectURL(file), name: file.name, ready: false };
            items.push(item);
            additions.push(item);
        }
        if (!additions.length) {
            if (duplicates) render('所选照片已在列表中。');
            return;
        }
        render('正在读取已选照片…');
        const results = await Promise.all(additions.map(async item => {
            const image = new Image();
            image.src = item.url;
            try {
                await image.decode();
                item.ready = true;
                return true;
            } catch {
                URL.revokeObjectURL(item.url);
                return false;
            }
        }));
        let failed = 0;
        items = items.filter(item => {
            const index = additions.indexOf(item);
            if (index < 0 || results[index]) return true;
            failed++;
            return false;
        });
        onChange(sources());
        render(failed ? failed + ' 张无法读取，请尝试 JPG、PNG 或 WebP。' : '');
    }

    pick.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
        const files = Array.from(input.files);
        input.value = '';
        appendFiles(files);
    });
    open.addEventListener('click', () => {
        dialogBody.append(picker);
        dialog.showModal();
        pick.focus();
    });
    dialog.addEventListener('close', () => {
        home.append(picker);
        open.focus();
    });
    return { sources };
}
