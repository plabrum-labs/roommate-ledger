export function Avatar({ name }: { name: string }) {
  return <span className="av">{name.trim().charAt(0).toUpperCase()}</span>
}
