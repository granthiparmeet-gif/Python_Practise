def multiply(a,b):
    """This is a Multiplication function
       a is the first number(int, float)
       b is the second number (int,float)  """
    x= a*b
    return x

y = multiply(3,4)
print(f"The sum of the two numbers is {y}")
print(multiply.__doc__)
help(multiply)

