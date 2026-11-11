// components/auth/auth-field-classes.ts
// The shared input class with the text size raised to 16px. Below 16px, iPhones zoom the page in
// when a box is tapped, which breaks the layout of a form that is meant to fit the screen.
import { fieldInputClass } from "@/components/ui/form-field";

export const authInputClass = `${fieldInputClass} text-base!`;
