export default (payload) => ({ a: String(payload.a ?? 3), b: String(payload.b ?? 11) });
