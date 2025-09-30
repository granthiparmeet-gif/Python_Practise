# def fact(n):
#     if n==0 or n==1:
#         return 1
#     else:
#         return n* fact(n-1)
    
# x = int(input("Enter the number: "))

# print(fact(x))

x = int(input("Enter the number : "))

fact =1
while x>0:
    fact= x * fact
    x=x-1

print(fact)