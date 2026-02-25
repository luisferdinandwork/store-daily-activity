'use client';
// components/employee/MobileOnlyGuard.tsx
// This element is shown on desktop screens, hiding the mobile app content.

export default function MobileOnlyGuard() {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&display=swap');

        .desktop-block {
          display: none;
          position: fixed;
          inset: 0;
          z-index: 9999;
          background: #0a0a0a;
          color: #fff;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 40px;
          font-family: 'Syne', sans-serif;
        }

        @media (min-width: 768px) {
          .desktop-block { display: flex; }
        }

        .desktop-block-icon {
          font-size: 64px;
          margin-bottom: 24px;
          animation: bounce 2s ease-in-out infinite;
        }

        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-8px); }
        }

        .desktop-block h1 {
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin-bottom: 12px;
          color: #fff;
        }

        .desktop-block p {
          font-size: 15px;
          color: rgba(255,255,255,0.5);
          max-width: 360px;
          line-height: 1.6;
        }

        .desktop-block .pill {
          margin-top: 32px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 99px;
          padding: 8px 20px;
          font-size: 13px;
          color: rgba(255,255,255,0.6);
        }
      `}</style>

      <div className="desktop-block">
        <div className="desktop-block-icon">📱</div>
        <h1>Mobile Only</h1>
        <p>The employee portal is designed exclusively for mobile devices. Please open this page on your phone.</p>
        <div className="pill">
          <span>●</span> Scan QR or open on mobile
        </div>
      </div>
    </>
  );
}