x = int(input("Enter the first number"))
y = int(input("Enter the second number"))
z = int(input("Enter the third number"))

# if ((x>y) and (x>z)):
#     print(f"The Greatest of all 3 numbers is {x}")
# elif(y>z):
#     print(f"The Greatest of all 3 numbers is {y}")
# else:
#     print(f"The Greatest of all 3 numbers is {z}")

mini = min(x,y,z)
maxi = max(x,y,z)

print(f"The smallest number is {mini} and the largest number is {maxi}")


