def calculate(num1:int, num2:int):
    summation = num1+num2
    multiplication = num1*num2
    return summation, multiplication
    

sum_returned, mul_returned = calculate (4,5)
print(f"The sum of two numbers is {sum_returned} and the product of two numbers is {mul_returned}")