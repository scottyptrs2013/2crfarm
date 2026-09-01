const SQUARE_API = "https://connect.squareup.com/v2/online-checkout/payment-links";
const SQUARE_VERSION = "2026-08-19";

const PRICES = {
  "Ranchhouse Pickles": 800,
  "Garlic Dill Pickles": 800,
  "The Tipsy Rancher": 800,
  "Sully's Signature": 1500,
  "Sweet Thai Chili": 1500,
  "Mexican": 1500,
  "Molé": 1500,
  "Cowboy Butter": 1500,
  "Cajun": 1500
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/create-checkout") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

      if (!env.SQUARE_ACCESS_TOKEN || !env.SQUARE_LOCATION_ID) {
        return json({ error: "Square checkout is not configured yet." }, 500);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid order data." }, 400);
      }

      const name = String(body.name || "").trim();
      const phone = String(body.phone || "").trim();
      const notes = String(body.notes || "").trim();
      const items = Array.isArray(body.items) ? body.items : [];

      if (!name || !phone || !items.length) {
        return json({ error: "Name, phone, and at least one item are required." }, 400);
      }

      const line_items = [];
      let total = 0;

      for (const item of items) {
        const key = String(item.key || "");
        const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
        if (!quantity) continue;

        if (key === "Chicken Broilers") {
          const weight = Math.max(0, Number(item.weight) || 0);
          if (!weight) return json({ error: "Please enter the broiler weight." }, 400);

          const unitPrice = Math.min(Math.round(weight * 500), 2500);
          line_items.push({
            name: `Chicken Broiler (${weight.toFixed(1)} lb)`,
            quantity: String(quantity),
            base_price_money: { amount: unitPrice, currency: "USD" },
            item_type: "ITEM"
          });
          total += unitPrice * quantity;
          continue;
        }

        if (!(key in PRICES)) {
          return json({ error: `Unknown product: ${key}` }, 400);
        }

        const unitPrice = PRICES[key];
        line_items.push({
          name: key,
          quantity: String(quantity),
          base_price_money: { amount: unitPrice, currency: "USD" },
          item_type: "ITEM"
        });
        total += unitPrice * quantity;
      }

      if (!line_items.length || total <= 0) {
        return json({ error: "Your order is empty." }, 400);
      }

      const safeNotes = notes.slice(0, 300);
      const paymentNote = `2CR pickup order — ${name} — ${phone}${safeNotes ? ` — ${safeNotes}` : ""}`.slice(0, 500);

      const squareBody = {
        idempotency_key: crypto.randomUUID(),
        description: `2nd Chance Ranch order for ${name}`.slice(0, 4096),
        payment_note: paymentNote,
        order: {
          location_id: env.SQUARE_LOCATION_ID,
          line_items
        },
        checkout_options: {
          redirect_url: "https://2crfarm.com/?payment=success",
          merchant_support_email: "orders@2crfarm.com"
        },
        pre_populated_data: {
          buyer_phone_number: phone
        }
      };

      const response = await fetch(SQUARE_API, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
          "Square-Version": SQUARE_VERSION
        },
        body: JSON.stringify(squareBody)
      });

      const data = await response.json();

      if (!response.ok || !data.payment_link?.url) {
        console.error("Square error", data);
        const detail = data?.errors?.[0]?.detail || "Square could not create the checkout.";
        return json({ error: detail }, 502);
      }

      return json({
        url: data.payment_link.url,
        orderId: data.payment_link.order_id,
        totalCents: total
      });
    }

    // Serve the existing static site.
    if (env.ASSETS) return env.ASSETS.fetch(request);

    return new Response("Not found", { status: 404 });
  }
};
