document.addEventListener('DOMContentLoaded', () => {
    // --- Mobile Menu Toggle ---
    const menuToggle = document.querySelector('.mobile-menu-toggle');
    const sidebar = document.querySelector('.docs-sidebar');
    const docsContent = document.querySelector('.docs-content');

    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.toggle('active');
            menuToggle.textContent = sidebar.classList.contains('active') ? '×' : '☰';
            menuToggle.style.fontSize = sidebar.classList.contains('active') ? '1.5rem' : '1.2rem';
        });

        // Close sidebar when clicking outside on mobile
        document.addEventListener('click', (e) => {
            if (sidebar.classList.contains('active') && 
                !sidebar.contains(e.target) && 
                !menuToggle.contains(e.target)) {
                sidebar.classList.remove('active');
                menuToggle.textContent = '☰';
                menuToggle.style.fontSize = '1.2rem';
            }
        });
    }

    // --- Active Link Highlighting ---
    const currentPath = window.location.pathname.split('/').pop() || 'index.html';
    const sidebarLinks = document.querySelectorAll('.sidebar-link');

    sidebarLinks.forEach(link => {
        if (link.getAttribute('href') === currentPath) {
            link.classList.add('active');
            
            // Scroll sidebar to active link if needed
            // Use setTimeout to ensure rendering is complete
            setTimeout(() => {
                link.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
        }
    });

    // --- Smooth Scroll for Anchor Links ---
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const targetId = this.getAttribute('href').substring(1);
            const targetElement = document.getElementById(targetId);

            if (targetElement) {
                // Adjust for fixed header height
                const headerOffset = 80;
                const elementPosition = targetElement.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

                window.scrollTo({
                    top: offsetPosition,
                    behavior: "smooth"
                });
            }
        });
    });

    // --- Copy Button Logic ---
    document.querySelectorAll('pre').forEach((pre) => {
        // Check if button already exists to prevent duplicates
        if (pre.querySelector('.copy-btn')) return;

        const button = document.createElement('button');
        button.className = 'copy-btn';
        button.type = 'button';
        button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
        
        // Inline styles for the button
        Object.assign(button.style, {
            position: 'absolute',
            right: '12px',
            top: '12px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '6px',
            color: '#a1a1aa',
            padding: '6px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
        });

        // Hover effect
        button.addEventListener('mouseenter', () => {
            button.style.background = 'rgba(255,255,255,0.1)';
            button.style.color = '#fff';
        });
        
        button.addEventListener('mouseleave', () => {
            button.style.background = 'rgba(255,255,255,0.05)';
            button.style.color = '#a1a1aa';
        });

        pre.style.position = 'relative';
        pre.appendChild(button);

        button.addEventListener('click', () => {
            const code = pre.querySelector('code');
            if (!code) return;
            
            navigator.clipboard.writeText(code.innerText).then(() => {
                const originalContent = button.innerHTML;
                button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A5F3FC" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                button.style.borderColor = '#A5F3FC';
                
                setTimeout(() => {
                    button.innerHTML = originalContent;
                    button.style.borderColor = 'rgba(255,255,255,0.1)';
                }, 2000);
            });
        });
    });
});