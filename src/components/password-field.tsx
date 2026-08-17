"use client";

import { useState } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";

export function PasswordField({ id, name = "password", autoComplete, label = "Contraseña", hint }: { id: string; name?: string; autoComplete: string; label?: string; hint?: string }) {
  const [visible, setVisible] = useState(false);
  return <div className="field"><label htmlFor={id}>{label}</label><div className="password-control"><input id={id} name={name} type={visible ? "text" : "password"} autoComplete={autoComplete} required minLength={name === "password" && autoComplete === "new-password" ? 12 : 8} maxLength={128} /><button type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? "Ocultar texto ingresado" : "Mostrar texto ingresado"} title={visible ? "Ocultar contraseña" : "Mostrar contraseña"}>{visible ? <EyeSlash size={18} /> : <Eye size={18} />}</button></div>{hint && <small>{hint}</small>}</div>;
}
