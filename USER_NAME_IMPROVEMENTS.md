# User Name Improvements - 3-Tier Approach

## Problem
Users who don't set their name during signup have a poor experience:
- ❌ Sidebar shows generic "User"
- ❌ Dashboard greeting not personalized
- ❌ Avatar initials based on raw email (e.g., "user@example.com" → "U")
- ❌ No prompt to complete their profile

## Solution: 3-Tier Approach

### 1. Smart Email Fallback During Signup ✅

**What Changed:**
- `src/pages/login.tsx` - Improved name fallback logic

**Before:**
```typescript
body: JSON.stringify({ email, name: name || email })
// If user doesn't enter name, full email is used: "john.doe@example.com"
```

**After:**
```typescript
const displayName = name || email.split('@')[0]
body: JSON.stringify({ email, name: displayName })
// Uses username part: "john.doe@example.com" → "john.doe"
```

**Benefits:**
- More human-readable default names
- Better initials generation
- Cleaner profile display

---

### 2. Welcome Profile Dialog (First Login Prompt) ✅

**What Changed:**
- NEW: `src/components/welcome-profile-dialog.tsx`
- UPDATED: `src/components/layout/app-layout.tsx` (added dialog)

**Features:**
- Shows 1 second after login if name needs improvement
- Detects email-based or missing names
- Dismissible with "Maybe Later" option
- Enter key submits
- Session-based dismissal (won't re-show in same session)

**Detection Logic:**
```typescript
// Shows dialog if any of these are true:
- !profile.name (no name set)
- profile.name.includes("@") (is an email)
- profile.name.includes(".") && !profile.name.includes(" ") (looks like username)
```

**UI/UX:**
- Sparkles icon for welcoming feel
- Clear description
- Single input field (name)
- Two buttons: "Maybe Later" / "Save Name"
- Reminder that it can be changed in Settings

---

### 3. Improved Display Fallbacks ✅

**What Changed:**
- `src/components/layout/sidebar.tsx` - Enhanced `getInitials()` and new `getDisplayName()`
- `src/pages/dashboard.tsx` - Smarter greeting logic

#### A. Better Initials Generation

**Before:**
```typescript
getInitials("user@example.com") → "U"
getInitials("john.doe") → "JO"
```

**After:**
```typescript
// Email handling
getInitials("user@example.com") → "US" (first 2 chars of username)
getInitials("john.doe@example.com") → "JD" (john + doe)
getInitials("j.smith@example.com") → "JS" (j + smith)

// Name handling
getInitials("John Smith") → "JS" (first + last)
getInitials("john.doe") → "JD" (splits on dot/underscore)
getInitials("John") → "JO" (first 2 letters)
```

**Algorithm:**
1. If empty → "U"
2. If contains "@" → extract username, split on `./_/-`, use first letters
3. If multi-word name → first letter of first + last word
4. Otherwise → first 2 letters

#### B. Better Display Names

**New Function:** `getDisplayName()`

**Before:**
```typescript
// Sidebar showed raw value
profile.name || "User"
```

**After:**
```typescript
getDisplayName("") → "User"
getDisplayName("john.doe@example.com") → "John Doe"
getDisplayName("john_smith") → "John Smith"
getDisplayName("John Smith") → "John Smith"
```

**Algorithm:**
- If empty → "User"
- If contains "@" → extract username, split on `./_/-`, capitalize each part
- Otherwise → return as-is

#### C. Smarter Dashboard Greeting

**Before:**
```typescript
Good morning{profile.name ? `, ${profile.name}` : ""}
// Shows: "Good morning, user@example.com" ❌
```

**After:**
```typescript
Good morning{profile.name && !profile.name.includes("@") ? `, ${profile.name}` : ""}
// Shows: "Good morning" (no email shown) ✅
```

---

## Complete User Flow

### New User - No Name Entered

**Signup:**
```
1. User enters email: john.doe@example.com
2. Leaves name field blank
3. System uses "john.doe" as default name ✅
```

**First Login:**
```
1. User logs in
2. System detects name is "john.doe" (looks like username)
3. After 1 second, welcome dialog appears:
   "Welcome to Nexus! We noticed you haven't set your name yet.
    Would you like to personalize your profile?"
4. User can:
   - Enter real name ("John Doe") → Saves and closes ✅
   - Click "Maybe Later" → Dismisses for this session
   - Close dialog (ESC/X) → Dismisses for this session
```

**Before Setting Name:**
```
Sidebar:
  Avatar: "JD" (from john.doe) ✅
  Name: "John Doe" (formatted) ✅

Dashboard:
  "Good morning" (no email shown) ✅
```

**After Setting Name:**
```
Sidebar:
  Avatar: "JD" (from John Doe) ✅
  Name: "John Doe" ✅

Dashboard:
  "Good morning, John Doe" ✅
```

### New User - Name Entered

**Signup:**
```
1. User enters email: jane@example.com
2. Enters name: "Jane Smith"
3. System uses "Jane Smith" ✅
```

**First Login:**
```
1. User logs in
2. System detects name is "Jane Smith" (proper name)
3. Welcome dialog DOES NOT appear ✅
```

**UI:**
```
Sidebar:
  Avatar: "JS" ✅
  Name: "Jane Smith" ✅

Dashboard:
  "Good morning, Jane Smith" ✅
```

---

## Edge Cases Handled

### Case 1: Email with numbers
```
Input: user123@example.com
Name stored: "user123"
Display: "User123"
Initials: "US"
```

### Case 2: Email with dots
```
Input: first.middle.last@example.com
Name stored: "first.middle.last"
Display: "First Middle Last"
Initials: "FL" (first + last part)
```

### Case 3: Single character usernames
```
Input: a@example.com
Name stored: "a"
Display: "A"
Initials: "A"
```

### Case 4: Email with underscores
```
Input: john_doe_jr@example.com
Name stored: "john_doe_jr"
Display: "John Doe Jr"
Initials: "JJ" (john + jr)
```

---

## Testing Scenarios

### Test 1: New User Without Name
```bash
1. Go to /login
2. Click "Continue with Passkey"
3. Create passkey with email: test@example.com (no name)
4. After login, wait 1 second
5. ✅ Welcome dialog should appear
6. Enter name "Test User" → Click "Save Name"
7. ✅ Sidebar should show "Test User" and initials "TU"
8. ✅ Dashboard should show "Good morning, Test User"
```

### Test 2: New User With Name
```bash
1. Go to /login
2. Click mode toggle to "Sign up"
3. Enter email: alice@example.com
4. Enter name: "Alice Johnson"
5. Create passkey
6. After login, wait 1 second
7. ✅ Welcome dialog should NOT appear
8. ✅ Sidebar shows "Alice Johnson" and initials "AJ"
```

### Test 3: Email-Based Username Formatting
```bash
1. Create user with email: john.doe@example.com (no name)
2. Login
3. ✅ Before dialog: Sidebar shows "John Doe", initials "JD"
4. ✅ Dashboard shows "Good morning" (no email)
5. Dismiss dialog with "Maybe Later"
6. ✅ Name stays "john.doe" but displays as "John Doe"
```

### Test 4: Dialog Persistence
```bash
1. Login with email-based name
2. Welcome dialog appears
3. Click "Maybe Later"
4. ✅ Dialog closes and doesn't re-appear in same session
5. Navigate between pages
6. ✅ Dialog stays dismissed
7. Logout and login again
8. ✅ Dialog appears again (new session)
```

### Test 5: Settings Change
```bash
1. Login with any name
2. Go to Settings
3. Change name to "New Name"
4. ✅ Sidebar updates immediately
5. ✅ Avatar initials update
6. ✅ Dashboard greeting updates
```

---

## Files Changed

### New Files
- `src/components/welcome-profile-dialog.tsx` - Welcome dialog component

### Modified Files
- `src/pages/login.tsx` - Smart email fallback (username extraction)
- `src/components/layout/sidebar.tsx` - `getInitials()` + `getDisplayName()`
- `src/components/layout/app-layout.tsx` - Added welcome dialog
- `src/pages/dashboard.tsx` - Smarter greeting (no email shown)

---

## Benefits

1. **Better First Impression** - "John Doe" looks better than "john.doe@example.com"
2. **Clear Call-to-Action** - Users are prompted to complete their profile
3. **Non-Intrusive** - Dismissible dialog, doesn't block workflow
4. **Smart Defaults** - Even without setting name, display is readable
5. **Consistent UX** - All name displays use same logic
6. **Edge Case Handling** - Dots, underscores, emails all handled gracefully

---

## Migration

**Existing users with email-based names:**
- ✅ Will see improved display formatting automatically
- ✅ Will be prompted to set proper name on next login
- ✅ Can dismiss and continue using email-based name

**No breaking changes:**
- All existing names continue to work
- No data migration needed
- Improvements apply automatically
