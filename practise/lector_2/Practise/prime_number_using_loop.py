x = int(input("Enter a positive whole number: "))

for i in range(2,x):
    if x%i ==0:
        print("The number is NOT a Prime Number")
        break
else:
    print("The number is a Prime Number")
