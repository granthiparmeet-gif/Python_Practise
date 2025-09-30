# x = int(input("Enter the first number: "))
# y = int(input("Enter the second number: "))

# print(f"First number {x} is greater than {y}" if x>y else f"{y} is greater than {x}")


x = int(input("Enter the first Number: "))
y = int(input("Enter the second Number: "))
z = int(input("Enter the third Number: "))

print(f"{x} is greater" if x>y and x>z else (f"{y} is greater" if y>z else f"{z} is greater"))