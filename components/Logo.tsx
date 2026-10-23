export default function Logo({ height = 32 }: { height?: number }) {
  const w = Math.round((height * 440) / 112);
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-light.svg" alt="Trackex" width={w} height={height} className="logo-light" style={{ height, width: w }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-dark.svg" alt="" aria-hidden="true" width={w} height={height} className="logo-dark" style={{ height, width: w }} />
    </>
  );
}
