import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { KioskApp } from "./kiosk/KioskApp.tsx";
import "./styles.css";

// /rejestracja is the patient form on the clinic iPad: its own screen, no staff UI around it.
const kiosk = /^\/rejestracja\/?$/.test(location.pathname);

createRoot(document.getElementById("root")!).render(<StrictMode>{kiosk ? <KioskApp /> : <App />}</StrictMode>);
