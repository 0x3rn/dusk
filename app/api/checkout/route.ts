import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

export async function POST(req: Request) {
  try {
    // In a real app, you would extract the user ID from the request or session
    // const body = await req.json();
    // const userId = body.userId;
    
    // For now we mock the userId as we wait for Firebase Auth
    const userId = "mock-user-123";
    
    // In production, you would fetch this URL dynamically based on the request origin
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Dusk Lifetime Access",
              description: "Secure Digital Vault and Dead Man's Switch.",
              images: ["https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=2070&auto=format&fit=crop"],
            },
            unit_amount: 5000, // $50.00 in cents
          },
          quantity: 1,
        },
      ],
      mode: "payment", // one-time payment
      success_url: `${baseUrl}/dashboard?success=true`,
      cancel_url: `${baseUrl}/?canceled=true`,
      metadata: {
        userId: userId, // Pass the user ID so the webhook knows who paid
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error("Stripe Checkout Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
