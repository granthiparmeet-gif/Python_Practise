def power(base:int, exponent:int=2):
    result = base**exponent
    return result

returned_result_1 = power(3,3)
returned_result_2 = power(3)
returned_result_3 = power(exponent=4 , base=3)
print(f"The result is {returned_result_1}")
print(f"The result is {returned_result_2}")
print(f"The result is {returned_result_3}")
