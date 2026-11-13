// External tool: India Post PIN code / post-office directory (free, no key).
export default async (req) => {
  const u = new URL(req.url);
  const pin = u.searchParams.get('pin'), place = u.searchParams.get('place');
  let url;
  if (pin && /^\d{6}$/.test(pin)) url = `https://api.postalpincode.in/pincode/${pin}`;
  else if (place && /^[\w .-]{2,40}$/.test(place)) url = `https://api.postalpincode.in/postoffice/${encodeURIComponent(place)}`;
  else return new Response('Give ?pin=6 digits or ?place=name', { status: 400 });
  const r = await fetch(url);
  return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json' } });
};
