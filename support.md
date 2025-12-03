# RecallSmith – Support & Help

Welcome 👋  
This page is the support and help center for **RecallSmith**, a spaced‑repetition flashcard app for full‑stack developers.

---

## 1. What is RecallSmith?

RecallSmith is a **spaced‑repetition trainer** focused on technical interview prep for full‑stack / front‑end developers.

Instead of passive reading, you review one card at a time:

- A clear **question**
- A concise **explanation**
- A practical **code snippet**
- A simple review flow: **Again / Hard / Good / Easy**

RecallSmith calculates the **next review time** for each card based on your response, so you spend less time cramming and more time actually remembering.

---

## 2. What’s included in the first version?

In this first public version, RecallSmith ships with one starter deck:

### JavaScript Core Basics (Starter Deck)

Covers essential JS topics that almost every front‑end / full‑stack interview touches:

- `var / let / const`, scope, hoisting
- Closures and lexical environment
- `this` and common binding patterns
- Prototypes and prototype chain
- Asynchronous JavaScript:
  - Callbacks
  - Promises
  - `async / await`
- Common pitfalls:
  - `==` vs `===`
  - Floating point precision issues
  - Common `Array` APIs (`map`, `filter`, `reduce`, …)

This deck is **completely free** in this version and can be reviewed **offline** once downloaded.

---

## 3. How does the spaced‑repetition work?

RecallSmith uses a simple interval model inspired by spaced‑repetition systems:

When you review a card, you choose one of four options:

- **Again** – I don’t remember this at all
- **Hard** – I kind of remember, but it was difficult
- **Good** – I remembered it with reasonable effort
- **Easy** – Very easy / obvious

Based on your choice, the app:

1. Updates the **interval** for that card (how many days until next review).
2. Schedules the next review date.
3. Shows you the card again **right away** if you tapped “Again”.

You don’t need to manage dates yourself.  
Just open the app, go to **Today’s reviews**, and follow the queue.

> Note: The exact algorithm may evolve in future versions, but the idea is always the same:  
> show you important cards **right before you forget them**, not too early and not too late.

---

## 4. Does the app require an account or login?

**No.**  
This first version of RecallSmith does **not** require an account, login, or subscription.

- All study progress is stored **locally on your device**.
- There is currently **no cloud sync** and no server‑side profile.

This keeps the first version:

- Simple to use;
- Fast to start;
- Private by default.

In future versions, optional accounts and sync may be added.  
If/when that happens, this will be clearly explained in the release notes and privacy policy.

---

## 5. What data does the app collect?

Short answer: **none**.

- RecallSmith does **not** collect any personally identifiable information.
- We do **not** use analytics SDKs, ad SDKs, or social login SDKs.
- Your review history, deck progress, and settings are stored **only on your device**.

The app does make a small network request to:

- Check a tiny **config JSON file** (for example, to know if a newer app version is required).
- Download updated deck content in the future.

These requests do **not** include personal identifiers such as name, email, or account ID.

For more details, see the full [Privacy Policy](./privacy.html) (or the Privacy link in the App Store listing).

---

## 6. Which platforms are supported?

Current version:

- **iOS** – via the App Store

Planned for the future (not yet available):

- **Android**
- Additional platforms depending on demand

---

## 7. Do I need an internet connection?

- You **need internet** for:

  - Downloading the app from the App Store;
  - Downloading or updating decks;
  - Optionally checking for new app versions.

- You can **study offline**:
  - Once the deck is stored on your device, you can review cards without network access.
  - Your progress is saved locally and will still be there next time you open the app.

---

## 8. I found a typo or mistake in a card. How can I report it?

Thank you! Improving card quality is very important.

Please send:

- The **deck name** (e.g. “JavaScript Core Basics”)
- The **card question** (or screenshot)
- What you think is wrong, and your suggested correction

to:

> 📧 **Support email:** `info@timeawake.co.nz`

(Replace this email with your real support address.)

We’ll review it and include fixes in the next content update.

---

## 9. I have a feature request. Where can I send it?

If you have ideas such as:

- New decks (HTTP, REST, .NET, SQL, AWS, Azure, etc.)
- New review modes or statistics
- Calendar improvements
- Dark themes or accessibility options

you can email:

> 📧 `info@timeawake.co.nz`

Subject suggestion:  
`[RecallSmith Feature Request] <short summary>`

While we can’t promise to implement every idea, we _do_ read all messages and use them to shape the roadmap.

---

## 10. I encountered a bug or crash. What should I do?

Sorry about that! To help us investigate, please include:

1. A short description of what you were doing;
2. Your device model and iOS version (e.g. iPhone 15, iOS 18.1);
3. Steps to reproduce, if possible;
4. A screenshot if relevant.

Send it to:

> 📧 `info@timeawake.co.nz`

We’ll try to reproduce the issue and fix it in a future update.

---

## 11. Contact

If you need help, have feedback, or want to say hi:

- 📧 **Email:** `info@timeawake.co.nz`
- 🌐 **Website:** `https://timeawake.co.nz/` (optional)

Thank you for using RecallSmith.  
Hope it helps you stay calm and confident for your next interview. 💪
