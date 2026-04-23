import json
import os

FILE_NAME = "expenses.json"

# ---------------------------
# Load existing data
# ---------------------------
def load_expenses():
    if os.path.exists(FILE_NAME):
        with open(FILE_NAME, "r") as file:
            return json.load(file)
    return []

# ---------------------------
# Save data
# ---------------------------
def save_expenses(expenses):
    with open(FILE_NAME, "w") as file:
        json.dump(expenses, file, indent=4)

# ---------------------------
# Add expense
# ---------------------------
def add_expense(expenses):
    try:
        amount = float(input("Enter amount: "))
        category = input("Enter category: ")
        note = input("Enter note: ")

        expense = {
            "amount": amount,
            "category": category,
            "note": note
        }

        expenses.append(expense)
        save_expenses(expenses)

        print("✅ Expense added successfully!\n")

    except ValueError:
        print("❌ Invalid amount!\n")

# ---------------------------
# View expenses
# ---------------------------
def view_expenses(expenses):
    if not expenses:
        print("No expenses found.\n")
        return

    for i, exp in enumerate(expenses, 1):
        print(f"{i}. ₹{exp['amount']} | {exp['category']} | {exp['note']}")
    print()

# ---------------------------
# Total spending
# ---------------------------
def total_spending(expenses):
    total = sum(exp["amount"] for exp in expenses)
    print(f"💰 Total Spending: ₹{total}\n")

# ---------------------------
# Filter by category
# ---------------------------
def filter_by_category(expenses):
    category = input("Enter category to filter: ")

    filtered = [e for e in expenses if e["category"].lower() == category.lower()]

    if not filtered:
        print("No matching expenses.\n")
        return

    for exp in filtered:
        print(f"₹{exp['amount']} | {exp['note']}")
    print()

# ---------------------------
# Main menu
# ---------------------------
def main():
    expenses = load_expenses()

    while True:
        print("==== Expense Tracker ====")
        print("1. Add Expense")
        print("2. View Expenses")
        print("3. Total Spending")
        print("4. Filter by Category")
        print("5. Exit")

        choice = input("Enter choice: ")

        if choice == "1":
            add_expense(expenses)
        elif choice == "2":
            view_expenses(expenses)
        elif choice == "3":
            total_spending(expenses)
        elif choice == "4":
            filter_by_category(expenses)
        elif choice == "5":
            print("Goodbye 👋")
            break
        else:
            print("Invalid choice!\n")

# ---------------------------
if __name__ == "__main__":
    main()