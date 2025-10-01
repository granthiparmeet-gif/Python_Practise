x = int(input("Enter the first number: "))
y = int(input("Enter the Second number: "))

n=max(x,y)

while True:
    if n%x==0 and n%y==0:
        lcm=n
        break
    n+=1

print("LCM is ", lcm)