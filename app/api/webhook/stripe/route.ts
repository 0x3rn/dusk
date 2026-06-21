import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import Stripe from "stripe";

// Mock Firestore update
async function grantLifetimeAccess(userId: string) {
  console.log(`[Firestore Mock] Granting lifetime access to user: ${userId}`);
  // In reality: 
  // await db.collection("users").doc(userId).update({ hasPaid: true });
}

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature") as string;

  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
  } catch (err: any) {
    console.error(`Webhook signature verification failed.`, err.message);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  // Handle the event
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    
    // Retrieve the user ID from the metadata
    const userId = session.metadata?.userId;
    
    if (userId) {
      await grantLifetimeAccess(userId);
    }
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
