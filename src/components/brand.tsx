import Link from "next/link";

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link className="brand" href={href} aria-label="Mi Boletín Judicial, inicio">
      <span className="brand-mark" aria-hidden="true"><span>MB</span></span>
      <span className="brand-name"><strong>Mi Boletín Judicial</strong><small>Vigilancia procesal</small></span>
    </Link>
  );
}
