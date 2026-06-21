import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { Resend } from "resend";
import twilio from "twilio";

admin.initializeApp();
const db = admin.firestore();

// In production, use Firebase Secret Manager for these
const resend = new Resend(process.env.RESEND_API_KEY || "mock-resend-key");
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const CHECK_IN_LIMIT_DAYS = 90;
const WARNING_DAYS_BEFORE = 7;

export const deadMansSwitchCron = onSchedule("every 24 hours", async (event: any) => {
  const now = admin.firestore.Timestamp.now().toMillis();
  const msPerDay = 1000 * 60 * 60 * 24;

  const usersSnapshot = await db.collection("users").get();

  for (const userDoc of usersSnapshot.docs) {
    const userData = userDoc.data();
    if (userData.isUnlocked) continue; // Already triggered

    const lastCheckIn = userData.lastCheckInDate?.toMillis() || now;
    const daysSinceCheckIn = Math.floor((now - lastCheckIn) / msPerDay);

    const timeRemaining = CHECK_IN_LIMIT_DAYS - daysSinceCheckIn;

    // Phase 1: Warning (T-minus 7 days)
    if (timeRemaining === WARNING_DAYS_BEFORE) {
      console.log(`[Warning] User ${userDoc.id} has 7 days left to check in.`);
      
      try {
        await resend.emails.send({
          from: "Dusk Vault <alerts@dusk.app>",
          to: userData.email,
          subject: "ACTION REQUIRED: Dusk Vault Warning",
          html: "<p>You have not checked into your Dusk Vault recently. If you do not check in within 7 days, your Dead Man's Switch will trigger, and your vault will be unlocked for your emergency contacts.</p><p><a href='https://dusk.app/dashboard'>Check In Now</a></p>"
        });

        // Use Twilio to send an SMS warning if the user has a phone number
        if (userData.phone) {
          await twilioClient.messages.create({
            body: "DUSK ALERT: You have 7 days to check in before your vault unlocks. Visit dusk.app/dashboard",
            from: process.env.TWILIO_PHONE_NUMBER || "+1234567890",
            to: userData.phone,
          });
        }
      } catch (err) {
        console.error(`Failed to send warning to ${userData.email}`, err);
      }
    }

    // Phase 2: Trigger (Limit Reached)
    if (timeRemaining <= 0) {
      console.log(`[TRIGGER] User ${userDoc.id} failed to check in. Triggering Dead Man's Switch!`);
      
      // Flip the unlock flag in Firestore
      await userDoc.ref.update({ isUnlocked: true });

      // Fetch emergency contacts subcollection
      const contactsSnapshot = await userDoc.ref.collection("emergencyContacts").get();

      for (const contactDoc of contactsSnapshot.docs) {
        const contactData = contactDoc.data();
        
        try {
          // Send Trigger Email to Emergency Contacts
          await resend.emails.send({
            from: "Dusk Vault <alerts@dusk.app>",
            to: contactData.email,
            subject: "URGENT: Dusk Vault Unlocked",
            html: `<p>Hello ${contactData.name},</p><p>${userData.email} has failed to check into their Dusk Digital Vault, and the Dead Man's Switch has been triggered.</p><p>As their designated emergency contact, their vault is now available to you.</p><p>Please use the secure link previously provided to you in your invitation email to view the decrypted contents.</p>`
          });
        } catch (err) {
          console.error(`Failed to send trigger email to contact ${contactData.email}`, err);
        }
      }
    }
  }
});
