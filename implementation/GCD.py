x = int(input("Enter the first number: "))
y = int(input("Enter the Second number: "))

gcd=1
n=1
while n<= min(x,y):
    if x%n==0 and y%n==0:
        gcd=n
    n+=1

print(gcd)