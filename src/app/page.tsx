import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  BellSimpleRinging,
  Briefcase,
  CalendarCheck,
  Check,
  ChatsCircle,
  ClockCounterClockwise,
  FileMagnifyingGlass,
  FilePdf,
  FingerprintSimple,
  FolderOpen,
  ShieldCheck,
  WhatsappLogo,
} from "@phosphor-icons/react/dist/ssr";
import { Brand } from "@/components/brand";

const whatsapp = "https://wa.me/526692122543?text=Hola%2C%20quiero%20informaci%C3%B3n%20sobre%20Mi%20Bolet%C3%ADn%20Judicial.";

export default function Home() {
  return <div className="home">
    <header className="public-header">
      <nav className="public-nav" aria-label="Navegación principal">
        <Brand />
        <div className="public-links"><a href="#producto">Producto</a><a href="#cobertura">Cobertura</a><a href="#suscripcion">Suscripción</a><Link className="button button-secondary button-small" href="/login">Iniciar sesión</Link><Link className="button button-primary button-small" href="/register">Comenzar</Link></div>
      </nav>
    </header>
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Vigilancia judicial para profesionales</p>
          <h1>El boletín,<br /><em>bajo control.</em></h1>
          <p className="hero-lede">Tus expedientes locales y federales, sus resoluciones y listados a sesión en una sola agenda de trabajo. Menos revisión manual; más certeza sobre lo que cambió.</p>
          <div className="hero-actions"><Link className="button button-primary" href="/register">Comenzar por $499 al mes <ArrowRight size={15} /></Link><a className="button button-secondary" href="#producto">Ver cómo funciona</a></div>
          <p className="hero-fine">Sin permanencia forzosa · Pago seguro con Stripe</p>
        </div>
        <div className="hero-visual" aria-label="Ejemplo del seguimiento de una publicación judicial">
          <div className="hero-architecture"><Image src="/images/architecture-justice-campus.png" alt="Arquitectura contemporánea de un complejo público de justicia" width={1678} height={943} priority sizes="(max-width: 820px) 100vw, 48vw" /></div>
          <article className="publication-sheet">
            <header className="sheet-head"><div><span className="sheet-kicker">Boletín de resoluciones</span><h2 className="sheet-title">Agenda del despacho</h2></div><div className="sheet-date">16 de agosto<br />de 2026</div></header>
            <p className="sheet-case">192/2025</p><p className="sheet-court">Juzgado Primero de lo Civil del Primer Partido Judicial</p>
            <p className="sheet-copy">Se recibe oficio de la autoridad federal, informa y se ordena agregar a autos.</p>
            <footer className="sheet-foot"><span>Recuperado 08:34</span><span>Origen oficial conservado</span></footer>
            <span className="watch-stamp">Movimiento<br />detectado</span>
          </article>
          <aside className="hero-session-note"><CalendarCheck size={19} weight="duotone" /><div><small>Seguimiento colegiado</small><strong>Listado para sesión</strong><span>20 de agosto · 10:00 h</span></div></aside>
        </div>
      </section>

      <section className="trust-band" aria-label="Principios del servicio"><div className="trust-inner"><strong>Una revisión que deja rastro.</strong><div><ShieldCheck size={23} /><span>Publicaciones oficiales y contexto del asunto en una sola vista.</span></div><div><FingerprintSimple size={23} /><span>Fecha de recuperación, origen y huella de integridad.</span></div><div><BellSimpleRinging size={23} /><span>Avisos de resoluciones, listados y resultados de sesión.</span></div></div></section>

      <section className="commercial-intro" id="producto">
        <div><p className="eyebrow">LA REVISIÓN DE TODOS LOS DÍAS</p><h2>Lo importante no es abrir el boletín.<br /><em>Es saber qué cambió.</em></h2></div>
        <p>Mi Boletín Judicial convierte publicaciones dispersas en una rutina clara para el despacho: registrar, vigilar, revisar y actuar. Cada asunto conserva su órgano, tipo procesal y número exactos.</p>
      </section>

      <section className="workflow-grid" aria-label="Cómo funciona Mi Boletín Judicial">
        <article><span>01</span><FolderOpen size={24} /><h3>Organiza</h3><p>Da de alta expedientes reales y colócalos en una o varias carpetas por cliente, área o equipo.</p></article>
        <article><span>02</span><ClockCounterClockwise size={24} /><h3>Vigila</h3><p>El sistema revisa el historial y vuelve a consultar cuando ingresas o actualizas tu espacio.</p></article>
        <article><span>03</span><BellSimpleRinging size={24} /><h3>Detecta</h3><p>Identifica nuevas resoluciones, listados a sesión y resultados sin mezclar asuntos homónimos.</p></article>
        <article><span>04</span><FilePdf size={24} /><h3>Trabaja</h3><p>Consulta por día o periodo y descarga un boletín práctico para preparar la toma de expedientes.</p></article>
      </section>

      <section className="feature-section">
        <div><p className="eyebrow">DISEÑADO PARA LITIGAR</p><h2>Tu jornada judicial, en una vista.</h2><p>Un centro de trabajo sobrio y rápido para consultar cada asunto sin perder el contexto procesal.</p></div>
        <div className="feature-list"><article className="feature-row"><Briefcase size={29} /><div><h3>Carpetas que reflejan tu práctica</h3><p>Un mismo expediente puede pertenecer a varios equipos, clientes o estrategias sin duplicar información.</p></div></article><article className="feature-row"><FileMagnifyingGlass size={29} /><div><h3>Expediente como centro</h3><p>Partes, cronología, resoluciones y sesiones organizadas por asunto y periodo.</p></div></article><article className="feature-row"><ChatsCircle size={29} /><div><h3>Un Asistente que conoce tu espacio</h3><p>Pregunta qué se publicó hoy, cuáles asuntos se listaron o agrega expedientes a tus carpetas.</p></div></article></div>
      </section>

      <section className="coverage-showcase" id="cobertura">
        <header><p className="eyebrow">DOS JURISDICCIONES. UNA AGENDA.</p><h2>La información correcta,<br />en el contexto correcto.</h2></header>
        <div className="coverage-columns"><article><span>PJE</span><h3>Poder Judicial del Estado de Jalisco</h3><p>Consulta por expediente en los órganos disponibles del boletín judicial, con nombres de partes y extractos cuando la fuente los publica.</p><ul><li><Check size={14} /> Historial de resoluciones</li><li><Check size={14} /> Directorio judicial navegable</li><li><Check size={14} /> Vistas diarias y por periodo</li></ul></article><article><span>PJF</span><h3>Poder Judicial de la Federación</h3><p>Acuerdos por ficha exacta del expediente y seguimiento de sesión para los órganos colegiados, atendiendo al tipo procesal.</p><ul><li><Check size={14} /> Acuerdos federales</li><li><Check size={14} /> Listado y fecha de sesión</li><li><Check size={14} /> Sentido y resultado publicados</li></ul></article></div>
      </section>

      <section className="commercial-pricing" id="suscripcion"><div><p className="eyebrow">PLAN PROFESIONAL</p><h2>Todo el seguimiento.<br />Una sola suscripción.</h2><p>Para profesionales y despachos que necesitan claridad diaria sin sumar otra tarea manual.</p></div><article><div className="commercial-price"><strong>$499</strong><span>MXN<br />al mes</span></div><ul>{["Asuntos locales y federales", "Carpetas y vistas por periodo", "Listados y resultados de sesión", "Avisos y Asistente incluidos"].map((item) => <li key={item}><Check size={15} weight="bold" />{item}</li>)}</ul><Link className="button button-primary" href="/register">Crear mi cuenta <ArrowRight size={15} /></Link></article></section>

      <section className="commercial-cta"><div><p className="eyebrow">EMPIEZA CON TUS ASUNTOS REALES</p><h2>Que ningún movimiento<br />se pierda entre pestañas.</h2></div><div><Link className="button button-primary" href="/register">Crear mi cuenta <ArrowRight size={15} /></Link><a href={whatsapp} target="_blank" rel="noreferrer">Hablar por WhatsApp <WhatsappLogo size={17} weight="fill" /></a></div></section>
    </main>
    <footer className="public-footer"><div className="public-footer-inner"><div><Brand /><p>Vigilancia judicial clara para el trabajo diario.</p></div><div className="public-footer-links"><a href={whatsapp} target="_blank" rel="noreferrer">Ayuda por WhatsApp</a><Link href="/subscribe">Suscripción</Link><Link href="/login">Acceso</Link><span>© 2026 Mi Boletín Judicial</span></div></div></footer>
    <a className="whatsapp-float" href={whatsapp} target="_blank" rel="noreferrer" aria-label="Solicitar información por WhatsApp"><WhatsappLogo size={24} weight="fill" /><span>¿Necesitas ayuda?</span></a>
  </div>;
}
