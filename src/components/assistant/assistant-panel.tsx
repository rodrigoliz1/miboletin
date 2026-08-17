"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChatCircleDots,
  Check,
  PaperPlaneTilt,
  Plus,
  SidebarSimple,
  Sparkle,
  Trash,
  X,
} from "@phosphor-icons/react";
import type { AssistantConversation, AssistantMessage } from "@/lib/assistant/types";
import { resilientFetch } from "@/lib/client/resilient-fetch";
import { AssistantMarkdown } from "@/components/assistant/assistant-markdown";

type ApiResult = {
  ok: boolean;
  error?: string;
  configured?: boolean;
  conversations?: AssistantConversation[];
  conversation?: AssistantConversation;
  messages?: AssistantMessage[];
  userMessage?: AssistantMessage;
  assistantMessage?: AssistantMessage;
};

const suggestions = [
  "¿Qué autos se publicaron hoy?",
  "¿Cuáles de mis asuntos ya se listaron a sesión?",
  "Resume los movimientos de este mes por carpeta.",
  "Agrega un expediente a una de mis carpetas.",
];

async function api(url: string, init?: RequestInit): Promise<ApiResult> {
  const method = init?.method?.toUpperCase() ?? "GET";
  const response = method === "GET" ? await resilientFetch(url, { cache: "no-store", ...init }, 3) : await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => ({ ok: false, error: "Respuesta no válida del servidor" })) as ApiResult;
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? "No fue posible completar la solicitud");
  return payload;
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" }).format(new Date(value));
}

export function AssistantPanel({ firstName }: { firstName: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [conversations, setConversations] = useState<AssistantConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadConversation = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api(`/api/assistant/conversations/${id}`);
      setActiveId(id);
      setMessages(result.messages ?? []);
      setHistoryOpen(false);
      return result.messages ?? [];
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible abrir la conversación");
      return null;
    } finally {
      setLoading(false);
    }
  };

  const loadConversations = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api("/api/assistant/conversations");
      const next = result.conversations ?? [];
      setConversations(next);
      setConfigured(result.configured !== false);
      setLoaded(true);
      if (next.length && !activeId) await loadConversation(next[0].id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible cargar los chats");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    const viewport = messagesRef.current;
    if (!viewport) return;
    const frame = window.requestAnimationFrame(() => {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: sending ? "smooth" : "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, sending]);

  const createConversation = async () => {
    if (!loaded || creating) return null;
    setCreating(true);
    setError(null);
    try {
      const result = await api("/api/assistant/conversations", { method: "POST" });
      if (!result.conversation) return null;
      setConversations((current) => [result.conversation!, ...current]);
      setActiveId(result.conversation.id);
      setMessages([]);
      window.setTimeout(() => inputRef.current?.focus(), 50);
      return result.conversation.id;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible crear el chat");
      return null;
    } finally {
      setCreating(false);
    }
  };

  const removeConversation = async (id: string) => {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    setError(null);
    try {
      await api(`/api/assistant/conversations/${id}`, { method: "DELETE" });
      const remaining = conversations.filter((item) => item.id !== id);
      setConversations(remaining);
      setConfirmDelete(null);
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
        if (remaining[0]) await loadConversation(remaining[0].id);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible eliminar el chat");
    }
  };

  const send = async (preset?: string) => {
    const content = (preset ?? input).trim();
    if (!content || sending || !configured) return;
    let conversationId = activeId;
    if (!conversationId) conversationId = await createConversation();
    if (!conversationId) return;
    const optimistic: AssistantMessage = { id: `pending-${conversationId}-${messages.length}`, role: "user", content, createdAt: new Date().toISOString() };
    setMessages((current) => [...current, optimistic]);
    setInput("");
    setSending(true);
    setError(null);
    try {
      const result = await api(`/api/assistant/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content }),
      });
      setMessages((current) => [
        ...current.filter((item) => item.id !== optimistic.id),
        ...(result.userMessage ? [result.userMessage] : []),
        ...(result.assistantMessage ? [result.assistantMessage] : []),
      ]);
      if (result.conversation) {
        setConversations((current) => [result.conversation!, ...current.filter((item) => item.id !== result.conversation!.id)]);
      }
    } catch (reason) {
      const recovered = await loadConversation(conversationId);
      const persisted = recovered?.some((item) => item.role === "user" && item.content.trim() === content);
      if (!persisted) {
        setError(reason instanceof Error ? reason.message : "No fue posible responder");
        setInput(content);
      }
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  return <>
    <button
      className="assistant-launcher"
      type="button"
      aria-label={open ? "Cerrar asistente" : "Abrir asistente de Mi Boletín"}
      aria-expanded={open}
      onClick={() => {
        if (open) setOpen(false);
        else {
          setOpen(true);
          if (!loaded) void loadConversations();
        }
      }}
    >
      {open ? <X size={20} /> : <ChatCircleDots size={23} weight="duotone" />}
      {!open && <span>Asistente</span>}
    </button>
    {open && <div className="assistant-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="assistant-drawer" role="dialog" aria-modal="true" aria-label="Asistente de Mi Boletín">
        <aside className="assistant-history" data-mobile-open={historyOpen}>
          <header><div><Sparkle size={16} weight="fill" /><strong>Mi asistente</strong></div><button type="button" onClick={createConversation} aria-label="Nuevo chat" disabled={!loaded || loading || creating}><Plus size={17} /></button></header>
          <div className="assistant-conversation-list">
            {!conversations.length && loaded && <p className="assistant-history-empty">Tus conversaciones aparecerán aquí.</p>}
            {conversations.map((item) => <div className="assistant-conversation-row" data-active={activeId === item.id} key={item.id}>
              <button type="button" className="assistant-conversation-open" onClick={() => void loadConversation(item.id)}>
                <span>{item.title}</span><small>{shortDate(item.updatedAt)}</small>
              </button>
              <button className="assistant-delete" data-confirm={confirmDelete === item.id} type="button" onClick={() => void removeConversation(item.id)} aria-label={confirmDelete === item.id ? `Confirmar eliminación de ${item.title}` : `Eliminar ${item.title}`} title={confirmDelete === item.id ? "Confirmar eliminación" : "Eliminar chat"}>
                {confirmDelete === item.id ? <Check size={14} weight="bold" /> : <Trash size={14} />}
              </button>
            </div>)}
          </div>
          <button className="assistant-new" type="button" onClick={createConversation} disabled={!loaded || loading || creating}><Plus size={15} /> {creating ? "Creando…" : "Nuevo chat"}</button>
        </aside>
        <div className="assistant-chat">
          <header className="assistant-chat-header">
            <div><span className="assistant-status-dot" /><div><strong>Consulta tus asuntos</strong><small>Respuestas basadas en tus datos verificados</small></div></div>
            <div className="assistant-chat-actions"><button className="assistant-history-toggle" type="button" onClick={() => setHistoryOpen((value) => !value)} aria-label="Ver conversaciones"><SidebarSimple size={18} /></button><button type="button" onClick={() => setOpen(false)} aria-label="Cerrar asistente"><X size={19} /></button></div>
          </header>
          <div className="assistant-messages" ref={messagesRef} role="log" aria-live="polite" aria-label="Mensajes de la conversación">
            {loading && !messages.length ? <div className="assistant-loading"><span /><span /><span /></div> : !messages.length ? <div className="assistant-welcome">
              <span><Sparkle size={22} weight="duotone" /></span>
              <h2>Hola, {firstName}.</h2>
              <p>Puedo revisar los acuerdos, alertas y listados a sesión que ya están guardados en tu espacio.</p>
              {!configured ? <div className="assistant-config-warning"><strong>Falta conectar el Asistente.</strong><small>Agrega <code>AI_API_KEY</code> y los modelos en las variables del servidor para habilitar respuestas.</small></div> : <div className="assistant-suggestions">{suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => void send(suggestion)}>{suggestion}</button>)}</div>}
            </div> : messages.map((item) => <article className={`assistant-message assistant-message-${item.role}`} key={item.id}>
              <span>{item.role === "assistant" ? <Sparkle size={14} weight="fill" /> : firstName.slice(0, 1).toUpperCase()}</span>
              <div>{item.role === "assistant" ? <AssistantMarkdown content={item.content} /> : <p>{item.content}</p>}<time>{new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" }).format(new Date(item.createdAt))}</time></div>
            </article>)}
            {sending && <article className="assistant-message assistant-message-assistant"><span><Sparkle size={14} weight="fill" /></span><div className="assistant-thinking"><i /><i /><i /><small>Consultando tus datos</small></div></article>}
          </div>
          {error && <div className="assistant-error" role="alert">{error}<button type="button" onClick={() => setError(null)} aria-label="Cerrar aviso"><X size={13} /></button></div>}
          <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Pregunta sobre tus acuerdos o sesiones…" maxLength={4000} rows={1} disabled={!configured || !loaded || loading} aria-label="Mensaje para el asistente" />
            <button type="submit" disabled={!input.trim() || sending || !configured} aria-label="Enviar mensaje"><PaperPlaneTilt size={18} weight="fill" /></button>
            <small>Verifica siempre el texto y enlace de la fuente oficial. No sustituye asesoría jurídica.</small>
          </form>
        </div>
      </section>
    </div>}
  </>;
}
