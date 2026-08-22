def fact(num):
    factorial = 1
    for i in range (1, num+1):
        factorial =  i * factorial
    return factorial

returned_factorial = fact(4)
print (f"The factorial of this number is {returned_factorial}")