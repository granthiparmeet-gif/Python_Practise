# x = int(input("Enter the number you wish to find the factorial of: "))
# fact = 1
# while (x>=1):
#     fact = (fact * x)
#     x = x-1
   
# print(fact)

x = int(input("Enter the number you wish to find the factorial of: "))

fact = 1 
for i in range(1,x+1):
    fact *= i

print(fact)