import React from "react";
import { Settings, ArrowLeft } from "lucide-react";

export function Titlebar({ currentPage, onNavigate }) {
  const logoSrc = `${import.meta.env.BASE_URL}Document.svg`;

  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <img className="titlebar-logo" src={logoSrc} alt="Orb" />
        <span className="titlebar-brand">ORB</span>
        <div className="titlebar-nav">
          <button
            className={`titlebar-btn ${currentPage === "home" ? "active" : ""}`}
            onClick={() => onNavigate("home")}
            title="Recordings"
          >
            <span>Recordings</span>
          </button>
          <button
            className={`titlebar-btn ${currentPage === "settings" ? "active" : ""}`}
            onClick={() =>
              onNavigate(currentPage === "settings" ? "home" : "settings")
            }
            title="Settings"
          >
            <span>Settings</span>
          </button>
        </div>
      </div>
      <div className="titlebar-spacer" />
    </div>
  );
}
