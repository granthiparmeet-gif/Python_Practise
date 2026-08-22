x = int(input("Enter the first number: "))
y = int(input("Enter the second number: "))


# n=1
# lcm = 1

# while n<min(x,y):
#     if x%n==0 and y%n==0:
#         lcm=n
#     n+=1

# print(lcm)

n=min(x,y)

while True:
    if n%x==0 and n%y==0:
        gcd = n
        break
    n+=1

print(gcd)
